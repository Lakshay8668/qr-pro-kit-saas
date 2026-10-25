// api/_lib/events.js — Event Management & QR Ticket Check-In Handler
// Multi-tenant, secure event management, guest lists, QR ticket issuance,
// concurrency-controlled check-ins, and analytics.

import crypto from "node:crypto";
import { isAdminUid } from "./adminAuth.js";

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
};

class Fail extends Error {
  constructor(status, error, message, extra = {}) {
    super(message);
    this.status = status;
    this.body = { error, message, ...extra };
  }
}

export function getPublicBaseUrl() {
  const env = process.env;
  return (
    env.PUBLIC_BASE_URL ||
    env.VITE_PUBLIC_BASE_URL ||
    (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : "") ||
    "https://qr-pro-kit-saas-production.up.railway.app"
  ).replace(/\/+$/, "");
}

const newId = (prefix = "") =>
  `${prefix}${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;

const newTicketToken = () => crypto.randomBytes(16).toString("hex"); // 32 unguessable hex chars

export function createEventsHandler({ getDb, serverTs, verify }) {
  return async function handler(req, res) {
    try {
      const action = String(req.query?.action || "");

      // ------------------------------------------------------------- PUBLIC CHECK-IN / TOKEN VALIDATION
      // Scanner can verify or check in a ticket token without requiring full dashboard organizer login,
      // but validates the token strictly against persistent database records.
      if (action === "check-ticket") {
        const token = String(req.query?.token || req.query?.ticketToken || "").trim();
        if (!token) throw new Fail(400, "bad_request", "Missing ticket token.");

        const db = getDb();
        const snap = await db.collection("tickets").where("ticketToken", "==", token).limit(1).get();
        if (snap.empty) {
          throw new Fail(404, "invalid_ticket", "Invalid ticket token. No record found.");
        }
        const ticketDoc = snap.docs[0];
        const ticket = { id: ticketDoc.id, ...ticketDoc.data() };

        const evtSnap = await db.collection("events").doc(ticket.eventId).get();
        const event = evtSnap.exists ? { id: evtSnap.id, ...evtSnap.data() } : null;

        return json(res, 200, {
          ok: true,
          ticket: {
            id: ticket.id,
            guestName: ticket.guestName,
            ticketType: ticket.ticketType,
            company: ticket.company || "",
            status: ticket.status,
            checkInTime: ticket.checkInTime || null,
            checkedInBy: ticket.checkedInBy || null,
          },
          event: event
            ? {
                id: event.id,
                name: event.name,
                eventDate: event.eventDate,
                startTime: event.startTime,
                venueName: event.venueName,
                status: event.status,
              }
            : null,
        });
      }

      if (req.method === "POST" && action === "check-in") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
        const token = String(body.token || body.ticketToken || "").trim();
        const eventId = String(body.eventId || "").trim();
        const operator = String(body.operator || body.checkedInBy || "Gate Scanner").trim().slice(0, 80);

        if (!token) throw new Fail(400, "bad_request", "Missing ticket token.");

        const db = getDb();
        const snap = await db.collection("tickets").where("ticketToken", "==", token).limit(1).get();
        if (snap.empty) {
          return json(res, 404, {
            ok: false,
            code: "invalid_ticket",
            message: "Invalid ticket token. No ticket found with this code.",
          });
        }

        const ticketDoc = snap.docs[0];
        const ticketRef = ticketDoc.ref;
        const ticket = ticketDoc.data();

        if (eventId && ticket.eventId !== eventId) {
          return json(res, 400, {
            ok: false,
            code: "wrong_event",
            message: "This ticket belongs to a different event.",
          });
        }

        const evtSnap = await db.collection("events").doc(ticket.eventId).get();
        if (!evtSnap.exists) {
          return json(res, 404, {
            ok: false,
            code: "event_not_found",
            message: "The event associated with this ticket was not found.",
          });
        }
        const event = evtSnap.data();

        if (event.status === "Cancelled") {
          return json(res, 400, {
            ok: false,
            code: "event_cancelled",
            message: "This event has been cancelled. Ticket entry is denied.",
          });
        }

        if (ticket.status === "Revoked") {
          return json(res, 400, {
            ok: false,
            code: "revoked",
            message: "This ticket has been revoked by the organiser.",
          });
        }

        if (ticket.status === "CheckedIn") {
          return json(res, 409, {
            ok: false,
            code: "already_checked_in",
            message: `Ticket already checked in at ${ticket.checkInTime ? new Date(ticket.checkInTime).toLocaleTimeString() : "earlier"}.`,
            checkInTime: ticket.checkInTime,
            checkedInBy: ticket.checkedInBy || null,
            ticket: {
              id: ticketDoc.id,
              guestName: ticket.guestName,
              ticketType: ticket.ticketType,
              company: ticket.company || "",
            },
            event: {
              id: ticket.eventId,
              name: event.name,
            },
          });
        }

        // Atomic check-in transition
        const now = new Date();
        await ticketRef.update({
          status: "CheckedIn",
          checkInTime: now,
          checkedInBy: operator,
        });

        return json(res, 200, {
          ok: true,
          code: "success",
          message: "Valid ticket — Check-in successful!",
          ticket: {
            id: ticketDoc.id,
            guestName: ticket.guestName,
            guestEmail: ticket.guestEmail || "",
            ticketType: ticket.ticketType,
            company: ticket.company || "",
            status: "CheckedIn",
            checkInTime: now,
            checkedInBy: operator,
          },
          event: {
            id: ticket.eventId,
            name: event.name,
            venueName: event.venueName,
          },
        });
      }

      // ------------------------------------------------------------- AUTHENTICATED ORGANISER ROUTES
      const token = String(req.headers.authorization || req.headers.Authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) throw new Fail(401, "sign_in_required", "Please sign in to manage events.");
      let me;
      try {
        me = await verify(token);
      } catch {
        throw new Fail(401, "bad_token", "Your session expired — sign in again.");
      }

      const db = getDb();
      const isAdmin = isAdminUid(me.uid);
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

      // ------------------------------------------------------------- GET: list events
      if (req.method === "GET" && action === "list") {
        const eventsSnap = await db.collection("events").where("ownerId", "==", me.uid).get();
        const events = eventsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const ticketsSnap = await db.collection("tickets").where("ownerId", "==", me.uid).get();
        const tickets = ticketsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // Map tickets count & check-in count per event
        const ticketsByEvent = {};
        const checkinsByEvent = {};
        for (const t of tickets) {
          ticketsByEvent[t.eventId] = (ticketsByEvent[t.eventId] || 0) + 1;
          if (t.status === "CheckedIn") {
            checkinsByEvent[t.eventId] = (checkinsByEvent[t.eventId] || 0) + 1;
          }
        }

        const todayStr = new Date().toISOString().slice(0, 10);
        let upcomingCount = 0;
        let completedCount = 0;

        for (const evt of events) {
          evt.ticketsCount = ticketsByEvent[evt.id] || 0;
          evt.checkedInCount = checkinsByEvent[evt.id] || 0;
          evt.attendancePercentage =
            evt.ticketsCount > 0 ? Math.round((evt.checkedInCount / evt.ticketsCount) * 100) : 0;

          if (evt.status === "Completed" || (evt.eventDate && evt.eventDate < todayStr && evt.status !== "Cancelled")) {
            completedCount++;
          } else if (evt.status !== "Cancelled") {
            upcomingCount++;
          }
        }

        events.sort((a, b) => {
          const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tb - ta;
        });

        const totalTickets = tickets.length;
        const checkedInGuests = tickets.filter((t) => t.status === "CheckedIn").length;
        const pendingCheckIns = tickets.filter((t) => t.status === "Valid").length;
        const attendancePercentage = totalTickets > 0 ? Math.round((checkedInGuests / totalTickets) * 100) : 0;

        const stats = {
          totalEvents: events.length,
          upcomingEvents: upcomingCount,
          completedEvents: completedCount,
          totalRegisteredGuests: totalTickets,
          totalTicketsGenerated: totalTickets,
          checkedInGuests,
          pendingCheckIns,
          attendancePercentage,
        };

        return json(res, 200, { ok: true, events, stats });
      }

      // ------------------------------------------------------------- GET: single event with tickets
      if (req.method === "GET" && action === "get") {
        const id = String(req.query?.id || "");
        if (!id) throw new Fail(400, "bad_request", "Missing event ID.");

        const evtDoc = await db.collection("events").doc(id).get();
        if (!evtDoc.exists) throw new Fail(404, "not_found", "Event not found.");
        const eventData = evtDoc.data();
        if (eventData.ownerId !== me.uid && !isAdmin) throw new Fail(403, "forbidden", "Access denied.");

        const ticketsSnap = await db.collection("tickets").where("eventId", "==", id).get();
        const tickets = ticketsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const totalIssued = tickets.length;
        const checkedInCount = tickets.filter((t) => t.status === "CheckedIn").length;
        const pendingCount = tickets.filter((t) => t.status === "Valid").length;
        const revokedCount = tickets.filter((t) => t.status === "Revoked").length;
        const attendancePercentage = totalIssued > 0 ? Math.round((checkedInCount / totalIssued) * 100) : 0;

        // Breakdown by ticket type
        const typeBreakdown = {};
        for (const t of tickets) {
          const type = t.ticketType || "General Admission";
          if (!typeBreakdown[type]) {
            typeBreakdown[type] = { total: 0, checkedIn: 0 };
          }
          typeBreakdown[type].total++;
          if (t.status === "CheckedIn") typeBreakdown[type].checkedIn++;
        }

        // Timeline of checkins
        const checkinsTimeline = tickets
          .filter((t) => t.status === "CheckedIn" && t.checkInTime)
          .map((t) => ({
            time: t.checkInTime,
            guestName: t.guestName,
            ticketType: t.ticketType,
          }))
          .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

        const event = {
          id: evtDoc.id,
          ...eventData,
          ticketsCount: totalIssued,
          checkedInCount,
          pendingCount,
          revokedCount,
          attendancePercentage,
          typeBreakdown,
          checkinsTimeline,
        };

        return json(res, 200, { ok: true, event, tickets });
      }

      // ------------------------------------------------------------- POST: create event
      if (req.method === "POST" && action === "create") {
        const raw = body.event || body;
        const name = String(raw.name || "").trim().slice(0, 150);
        if (!name || name.length < 2) {
          throw new Fail(400, "bad_request", "Event name is required (minimum 2 characters).");
        }

        const venueName = String(raw.venueName || "").trim().slice(0, 150);
        if (!venueName) throw new Fail(400, "bad_request", "Venue name is required.");

        const venueAddress = String(raw.venueAddress || "").trim().slice(0, 300);
        if (!venueAddress) throw new Fail(400, "bad_request", "Venue address is required.");

        const eventDate = String(raw.eventDate || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
          throw new Fail(400, "bad_request", "Valid event date (YYYY-MM-DD) is required.");
        }

        const startTime = String(raw.startTime || "").trim();
        const endTime = String(raw.endTime || "").trim();
        if (!startTime) throw new Fail(400, "bad_request", "Event start time is required.");

        const organiserName = String(raw.organiserName || raw.organizerName || me.email?.split("@")[0] || "Organizer").trim().slice(0, 100);
        const contactEmail = String(raw.contactEmail || me.email || "").trim().slice(0, 100);
        const contactPhone = String(raw.contactPhone || "").trim().slice(0, 30);
        const description = String(raw.description || "").trim().slice(0, 2000);
        const bannerUrl = String(raw.bannerUrl || "").trim().slice(0, 1000);
        const registrationDeadline = raw.registrationDeadline ? String(raw.registrationDeadline).trim() : null;

        const capacity = parseInt(raw.capacity, 10);
        if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50000) {
          throw new Fail(400, "bad_request", "Event capacity must be an integer between 1 and 50,000.");
        }

        const status = ["Draft", "Published", "Completed", "Cancelled"].includes(raw.status)
          ? raw.status
          : "Published";

        // Validate ticket types
        let ticketTypes = Array.isArray(raw.ticketTypes) && raw.ticketTypes.length > 0
          ? raw.ticketTypes.map((t, idx) => ({
              id: String(t.id || `type_${idx + 1}`),
              name: String(t.name || "General Admission").trim().slice(0, 50),
              quantity: Math.max(1, parseInt(t.quantity, 10) || capacity),
              price: Math.max(0, parseFloat(t.price) || 0),
            }))
          : [
              { id: "gen", name: "General Admission", quantity: capacity, price: 0 },
            ];

        const id = newId("evt_");
        const doc = {
          id,
          ownerId: me.uid,
          name,
          description,
          bannerUrl: bannerUrl || null,
          venueName,
          venueAddress,
          eventDate,
          startTime,
          endTime: endTime || startTime,
          organiserName,
          contactEmail,
          contactPhone,
          registrationDeadline,
          capacity,
          status,
          ticketTypes,
          createdAt: serverTs(),
          updatedAt: serverTs(),
        };

        await db.collection("events").doc(id).set(doc);
        return json(res, 200, { ok: true, id, event: doc });
      }

      // ------------------------------------------------------------- POST: update event
      if (req.method === "POST" && action === "update") {
        const id = String(body.id || req.query?.id || "").trim();
        if (!id) throw new Fail(400, "bad_request", "Missing event ID.");

        const ref = db.collection("events").doc(id);
        const snap = await ref.get();
        if (!snap.exists) throw new Fail(404, "not_found", "Event not found.");
        const cur = snap.data();
        if (cur.ownerId !== me.uid && !isAdmin) throw new Fail(403, "forbidden", "Access denied.");

        const patch = body.patch || body;
        const out = { updatedAt: serverTs() };

        if ("name" in patch) {
          const n = String(patch.name || "").trim().slice(0, 150);
          if (!n || n.length < 2) throw new Fail(400, "bad_request", "Event name must be at least 2 characters.");
          out.name = n;
        }
        if ("description" in patch) out.description = String(patch.description || "").trim().slice(0, 2000);
        if ("venueName" in patch) out.venueName = String(patch.venueName || "").trim().slice(0, 150);
        if ("venueAddress" in patch) out.venueAddress = String(patch.venueAddress || "").trim().slice(0, 300);
        if ("eventDate" in patch) {
          const d = String(patch.eventDate || "").trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Fail(400, "bad_request", "Valid event date (YYYY-MM-DD) is required.");
          out.eventDate = d;
        }
        if ("startTime" in patch) out.startTime = String(patch.startTime || "").trim();
        if ("endTime" in patch) out.endTime = String(patch.endTime || "").trim();
        if ("organiserName" in patch) out.organiserName = String(patch.organiserName || "").trim().slice(0, 100);
        if ("contactEmail" in patch) out.contactEmail = String(patch.contactEmail || "").trim().slice(0, 100);
        if ("contactPhone" in patch) out.contactPhone = String(patch.contactPhone || "").trim().slice(0, 30);
        if ("bannerUrl" in patch) out.bannerUrl = String(patch.bannerUrl || "").trim().slice(0, 1000);
        if ("registrationDeadline" in patch) out.registrationDeadline = patch.registrationDeadline ? String(patch.registrationDeadline).trim() : null;

        if ("capacity" in patch) {
          const cap = parseInt(patch.capacity, 10);
          if (!Number.isInteger(cap) || cap < 1) throw new Fail(400, "bad_request", "Capacity must be a positive integer.");
          // Verify new capacity is not less than currently issued tickets
          const tSnap = await db.collection("tickets").where("eventId", "==", id).get();
          if (cap < tSnap.size) {
            throw new Fail(400, "bad_request", `Capacity cannot be reduced below ${tSnap.size} (the number of tickets already issued).`);
          }
          out.capacity = cap;
        }

        if ("status" in patch) {
          if (!["Draft", "Published", "Completed", "Cancelled"].includes(patch.status)) {
            throw new Fail(400, "bad_request", "Invalid status value.");
          }
          out.status = patch.status;
        }

        if ("ticketTypes" in patch && Array.isArray(patch.ticketTypes)) {
          out.ticketTypes = patch.ticketTypes.map((t, idx) => ({
            id: String(t.id || `type_${idx + 1}`),
            name: String(t.name || "General Admission").trim().slice(0, 50),
            quantity: Math.max(1, parseInt(t.quantity, 10) || (out.capacity || cur.capacity)),
            price: Math.max(0, parseFloat(t.price) || 0),
          }));
        }

        await ref.update(out);
        return json(res, 200, { ok: true, id, updated: out });
      }

      // ------------------------------------------------------------- POST: delete event
      if (req.method === "POST" && action === "delete") {
        const id = String(body.id || req.query?.id || "").trim();
        if (!id) throw new Fail(400, "bad_request", "Missing event ID.");

        const ref = db.collection("events").doc(id);
        const snap = await ref.get();
        if (!snap.exists) return json(res, 200, { ok: true });
        const cur = snap.data();
        if (cur.ownerId !== me.uid && !isAdmin) throw new Fail(403, "forbidden", "Access denied.");

        // Delete associated tickets
        const ticketsSnap = await db.collection("tickets").where("eventId", "==", id).get();
        if (!ticketsSnap.empty) {
          const batch = db.batch();
          ticketsSnap.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }

        await ref.delete();
        return json(res, 200, { ok: true, id });
      }

      // ------------------------------------------------------------- POST: create single ticket
      if (req.method === "POST" && action === "create-ticket") {
        const eventId = String(body.eventId || req.query?.eventId || "").trim();
        if (!eventId) throw new Fail(400, "bad_request", "Missing event ID.");

        const evtSnap = await db.collection("events").doc(eventId).get();
        if (!evtSnap.exists) throw new Fail(404, "not_found", "Event not found.");
        const event = evtSnap.data();
        if (event.ownerId !== me.uid && !isAdmin) throw new Fail(403, "forbidden", "Access denied.");

        const guestName = String(body.guestName || body.name || "").trim().slice(0, 100);
        if (!guestName || guestName.length < 2) {
          throw new Fail(400, "bad_request", "Guest name is required (minimum 2 characters).");
        }

        // Capacity check
        const tSnap = await db.collection("tickets").where("eventId", "==", eventId).get();
        if (tSnap.size >= event.capacity) {
          throw new Fail(400, "capacity_exceeded", `Event capacity of ${event.capacity} has been reached. Cannot issue additional tickets.`);
        }

        const ticketToken = newTicketToken();
        const base = getPublicBaseUrl();
        const ticketId = newId("tkt_");
        const doc = {
          id: ticketId,
          eventId,
          ownerId: me.uid,
          guestName,
          guestEmail: String(body.guestEmail || body.email || "").trim().slice(0, 100),
          guestPhone: String(body.guestPhone || body.phone || "").trim().slice(0, 30),
          ticketType: String(body.ticketType || "General Admission").trim().slice(0, 50),
          company: String(body.company || "").trim().slice(0, 100),
          customReference: String(body.customReference || body.ref || "").trim().slice(0, 100),
          ticketToken,
          verificationUrl: `${base}/checkin?token=${ticketToken}`,
          status: "Valid",
          checkInTime: null,
          checkedInBy: null,
          createdAt: serverTs(),
        };

        await db.collection("tickets").doc(ticketId).set(doc);
        return json(res, 200, { ok: true, ticket: doc });
      }

      // ------------------------------------------------------------- POST: bulk import guests
      if (req.method === "POST" && action === "import-guests") {
        const eventId = String(body.eventId || "").trim();
        if (!eventId) throw new Fail(400, "bad_request", "Missing event ID.");

        const evtSnap = await db.collection("events").doc(eventId).get();
        if (!evtSnap.exists) throw new Fail(404, "not_found", "Event not found.");
        const event = evtSnap.data();
        if (event.ownerId !== me.uid && !isAdmin) throw new Fail(403, "forbidden", "Access denied.");

        const rawGuests = Array.isArray(body.guests) ? body.guests : [];
        if (rawGuests.length === 0) {
          throw new Fail(400, "bad_request", "No guests supplied for import.");
        }
        if (rawGuests.length > 2000) {
          throw new Fail(400, "bad_request", "Maximum 2,000 guests can be imported in a single batch.");
        }

        // Fetch existing tickets for capacity and duplicate checking
        const existingSnap = await db.collection("tickets").where("eventId", "==", eventId).get();
        const existingTickets = existingSnap.docs.map((d) => d.data());
        const remainingCapacity = Math.max(0, event.capacity - existingTickets.length);

        if (rawGuests.length > remainingCapacity) {
          throw new Fail(
            400,
            "capacity_exceeded",
            `Importing ${rawGuests.length} guests exceeds the remaining event capacity of ${remainingCapacity} (Total capacity: ${event.capacity}, currently issued: ${existingTickets.length}).`
          );
        }

        const existingEmailSet = new Set(
          existingTickets.map((t) => (t.guestEmail || "").toLowerCase().trim()).filter(Boolean)
        );
        const existingKeySet = new Set(
          existingTickets.map(
            (t) => `${(t.guestName || "").toLowerCase().trim()}_${(t.guestEmail || "").toLowerCase().trim()}`
          )
        );

        const batchEmailSet = new Set();
        const batchKeySet = new Set();
        const toCreate = [];
        let duplicateCount = 0;
        let skippedCount = 0;
        const base = getPublicBaseUrl();

        for (const item of rawGuests) {
          const name = String(item.guest_name || item.guestName || item.name || "").trim().slice(0, 100);
          if (!name || name.length < 2) {
            skippedCount++;
            continue;
          }

          const email = String(item.guest_email || item.guestEmail || item.email || "").trim().slice(0, 100).toLowerCase();
          const key = `${name.toLowerCase()}_${email}`;

          // Check duplicate within batch or existing event records
          const isDup = (email && existingEmailSet.has(email)) ||
                        (email && batchEmailSet.has(email)) ||
                        existingKeySet.has(key) ||
                        batchKeySet.has(key);

          if (isDup) {
            duplicateCount++;
            continue;
          }
          if (email) batchEmailSet.add(email);
          batchKeySet.add(key);

          const ticketId = newId("tkt_");
          const ticketToken = newTicketToken();
          toCreate.push({
            id: ticketId,
            eventId,
            ownerId: me.uid,
            guestName: name,
            guestEmail: email,
            guestPhone: String(item.guest_phone || item.guestPhone || item.phone || "").trim().slice(0, 30),
            ticketType: String(item.ticket_type || item.ticketType || "General Admission").trim().slice(0, 50),
            company: String(item.company || "").trim().slice(0, 100),
            customReference: String(item.custom_reference || item.customReference || item.ref || "").trim().slice(0, 100),
            ticketToken,
            verificationUrl: `${base}/checkin?token=${ticketToken}`,
            status: "Valid",
            checkInTime: null,
            checkedInBy: null,
            createdAt: serverTs(),
          });
        }

        // Commit batch write
        if (toCreate.length > 0) {
          const batch = db.batch();
          for (const tkt of toCreate) {
            batch.set(db.collection("tickets").doc(tkt.id), tkt);
          }
          await batch.commit();
        }

        return json(res, 200, {
          ok: true,
          importedCount: toCreate.length,
          duplicateCount,
          skippedCount,
          totalProcessed: rawGuests.length,
          tickets: toCreate,
        });
      }

      // ------------------------------------------------------------- POST: revoke ticket
      if (req.method === "POST" && action === "revoke-ticket") {
        const ticketId = String(body.ticketId || req.query?.ticketId || "").trim();
        if (!ticketId) throw new Fail(400, "bad_request", "Missing ticket ID.");

        const ref = db.collection("tickets").doc(ticketId);
        const snap = await ref.get();
        if (!snap.exists) throw new Fail(404, "not_found", "Ticket not found.");
        const t = snap.data();
        if (t.ownerId !== me.uid && !isAdmin) throw new Fail(403, "forbidden", "Access denied.");

        await ref.update({ status: "Revoked" });
        return json(res, 200, { ok: true, ticketId, status: "Revoked", ticket: { ...t, status: "Revoked" } });
      }

      // ------------------------------------------------------------- POST: regenerate ticket token
      if (req.method === "POST" && action === "regenerate-ticket") {
        const ticketId = String(body.ticketId || req.query?.ticketId || "").trim();
        if (!ticketId) throw new Fail(400, "bad_request", "Missing ticket ID.");

        const ref = db.collection("tickets").doc(ticketId);
        const snap = await ref.get();
        if (!snap.exists) throw new Fail(404, "not_found", "Ticket not found.");
        const t = snap.data();
        if (t.ownerId !== me.uid && !isAdmin) throw new Fail(403, "forbidden", "Access denied.");

        const newToken = newTicketToken();
        const base = getPublicBaseUrl();
        const updatedFields = {
          ticketToken: newToken,
          verificationUrl: `${base}/checkin?token=${newToken}`,
          status: "Valid",
          checkInTime: null,
          checkedInBy: null,
        };

        await ref.update(updatedFields);
        return json(res, 200, { ok: true, ticketId, ...updatedFields, ticket: { ...t, ...updatedFields } });
      }

      // ------------------------------------------------------------- GET: export CSV
      if (req.method === "GET" && action === "export-csv") {
        const eventId = String(req.query?.id || req.query?.eventId || "").trim();
        if (!eventId) throw new Fail(400, "bad_request", "Missing event ID.");

        const evtDoc = await db.collection("events").doc(eventId).get();
        if (!evtDoc.exists) throw new Fail(404, "not_found", "Event not found.");
        const event = evtDoc.data();
        if (event.ownerId !== me.uid && !isAdmin) throw new Fail(403, "forbidden", "Access denied.");

        const snap = await db.collection("tickets").where("eventId", "==", eventId).get();
        const rows = snap.docs.map((d) => d.data());

        const csvHeaders = [
          "Ticket ID",
          "Guest Name",
          "Guest Email",
          "Guest Phone",
          "Ticket Type",
          "Company",
          "Custom Reference",
          "Status",
          "Checked In At",
          "Checked In By",
          "Verification URL",
        ];

        const escapeCsv = (str) => `"${String(str ?? "").replace(/"/g, '""')}"`;

        const csvLines = [
          csvHeaders.join(","),
          ...rows.map((r) =>
            [
              escapeCsv(r.id),
              escapeCsv(r.guestName),
              escapeCsv(r.guestEmail),
              escapeCsv(r.guestPhone),
              escapeCsv(r.ticketType),
              escapeCsv(r.company),
              escapeCsv(r.customReference),
              escapeCsv(r.status),
              escapeCsv(r.checkInTime ? new Date(r.checkInTime).toISOString() : ""),
              escapeCsv(r.checkedInBy),
              escapeCsv(r.verificationUrl),
            ].join(",")
          ),
        ];

        const csvData = csvLines.join("\n");
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="event-${eventId}-guests.csv"`);
        return res.end(csvData);
      }

      return json(res, 400, { error: "unknown_action", message: `Action "${action}" is not supported.` });
    } catch (e) {
      if (e instanceof Fail) return json(res, e.status, e.body);
      console.error("[Events API error]", e);
      return json(res, 500, { error: "server_error", message: e.message || "Something went wrong." });
    }
  };
}
