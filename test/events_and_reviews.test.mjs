// test/events_and_reviews.test.mjs
// Comprehensive test suite for Event Management System & Zero-API Google Review Generator

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeDb, callJson } from "./fakeDb.mjs";
import { createEventsHandler } from "../api/_lib/events.js";
import { extractPlaceIdLocally, isValidGoogleReviewUrl } from "../src/lib/googleReviewLocal.js";

const mockVerify = (token) => {
  if (token === "token_alice") {
    return Promise.resolve({ uid: "user_alice", email: "alice@example.com" });
  }
  if (token === "token_bob") {
    return Promise.resolve({ uid: "user_bob", email: "bob@example.com" });
  }
  throw new Error("Invalid mock token");
};

describe("TypQR Event Management & Zero-API Review Generator", () => {
  // =========================================================================
  // MODULE 1: EVENT MANAGEMENT
  // =========================================================================
  describe("Event Management System", () => {
    let db;
    let eventsHandler;

    test("setup mock environment", () => {
      db = makeDb();
      eventsHandler = createEventsHandler({
        getDb: () => db,
        serverTs: () => new Date().toISOString(),
        verify: mockVerify,
      });
      assert.ok(eventsHandler);
    });

    test("create event with field validations and capacity", async () => {
      // 1. Missing event name
      {
        const r = await callJson(eventsHandler, {
          method: "POST",
          query: { action: "create" },
          headers: { authorization: "Bearer token_alice" },
          body: { event: { name: "", capacity: 50, eventDate: "2026-11-01" } },
        });
        assert.equal(r.code, 400);
        assert.equal(r.body.error, "bad_request");
      }

      // 2. Missing event date
      {
        const r = await callJson(eventsHandler, {
          method: "POST",
          query: { action: "create" },
          headers: { authorization: "Bearer token_alice" },
          body: { event: { name: "Tech Summit", capacity: 50, eventDate: "" } },
        });
        assert.equal(r.code, 400);
      }

      // 3. Invalid capacity
      {
        const r = await callJson(eventsHandler, {
          method: "POST",
          query: { action: "create" },
          headers: { authorization: "Bearer token_alice" },
          body: { event: { name: "Tech Summit", capacity: 0, eventDate: "2026-11-01" } },
        });
        assert.equal(r.code, 400);
      }

      // 4. Valid event creation
      {
        const r = await callJson(eventsHandler, {
          method: "POST",
          query: { action: "create" },
          headers: { authorization: "Bearer token_alice" },
          body: {
            event: {
              name: "TypQR Global Expo 2026",
              venueName: "Metropolitan Convention Center",
              venueAddress: "100 Innovation Way",
              eventDate: "2026-11-15",
              startTime: "09:00",
              endTime: "18:00",
              organiserName: "Alice Organizer",
              capacity: 5, // small limit to test concurrency/limit control
              status: "Published",
            },
          },
        });
        assert.equal(r.code, 200);
        assert.equal(r.body.ok, true);
        assert.ok(r.body.event.id);
        assert.equal(r.body.event.ownerId, "user_alice");
        assert.equal(r.body.event.capacity, 5);
      }
    });

    test("list events and computed KPI stats", async () => {
      const r = await callJson(eventsHandler, {
        method: "GET",
        query: { action: "list" },
        headers: { authorization: "Bearer token_alice" },
      });
      assert.equal(r.code, 200);
      assert.equal(r.body.ok, true);
      assert.equal(r.body.events.length, 1);
      assert.equal(r.body.stats.totalEvents, 1);
      assert.equal(r.body.stats.upcomingEvents, 1);
      assert.equal(r.body.stats.totalTicketsGenerated, 0);
      assert.equal(r.body.stats.attendancePercentage, 0);
    });

    test("tenant isolation: Bob cannot view or edit Alice's event", async () => {
      // List events for Bob
      {
        const r = await callJson(eventsHandler, {
          method: "GET",
          query: { action: "list" },
          headers: { authorization: "Bearer token_bob" },
        });
        assert.equal(r.code, 200);
        assert.equal(r.body.events.length, 0);
        assert.equal(r.body.stats.totalEvents, 0);
      }

      // Bob tries to get Alice's event -> 403 Forbidden
      const aliceEventId = db._all("events")[0].id;
      {
        const r = await callJson(eventsHandler, {
          method: "GET",
          query: { action: "get", id: aliceEventId },
          headers: { authorization: "Bearer token_bob" },
        });
        assert.equal(r.code, 403);
      }

      // Bob tries to update Alice's event -> 403 Forbidden
      {
        const r = await callJson(eventsHandler, {
          method: "POST",
          query: { action: "update", id: aliceEventId },
          headers: { authorization: "Bearer token_bob" },
          body: { patch: { name: "Hacked Event" } },
        });
        assert.equal(r.code, 403);
      }
    });

    test("single ticket generation with 32-char hex cryptographic token", async () => {
      const eventId = db._all("events")[0].id;
      const r = await callJson(eventsHandler, {
        method: "POST",
        query: { action: "create-ticket" },
        headers: { authorization: "Bearer token_alice" },
        body: {
          eventId,
          guestName: "Sarah Connor",
          guestEmail: "sarah@resistance.org",
          guestPhone: "+15551234567",
          ticketType: "VIP",
          company: "Cyberdyne",
        },
      });
      assert.equal(r.code, 200);
      assert.equal(r.body.ok, true);
      assert.ok(r.body.ticket.id);
      assert.equal(r.body.ticket.guestName, "Sarah Connor");
      assert.equal(r.body.ticket.status, "Valid");
      assert.equal(r.body.ticket.ticketToken.length, 32); // 32-char hex token
      assert.match(r.body.ticket.ticketToken, /^[0-9a-f]{32}$/);
    });

    test("bulk guest import with duplicate detection & capacity checking", async () => {
      const eventId = db._all("events")[0].id;

      // Current tickets count = 1. Event capacity = 5. Remaining = 4.
      // Import 3 guests: 1 duplicate email (sarah@resistance.org), 2 new guests.
      const importList = [
        { guestName: "Sarah Duplicate", guestEmail: "sarah@resistance.org", ticketType: "VIP" },
        { guestName: "John Connor", guestEmail: "john@resistance.org", ticketType: "General Admission" },
        { guestName: "Kyle Reese", guestEmail: "kyle@resistance.org", ticketType: "Speaker" },
      ];

      const r = await callJson(eventsHandler, {
        method: "POST",
        query: { action: "import-guests" },
        headers: { authorization: "Bearer token_alice" },
        body: { eventId, guests: importList },
      });
      assert.equal(r.code, 200);
      assert.equal(r.body.ok, true);
      assert.equal(r.body.importedCount, 2);
      assert.equal(r.body.duplicateCount, 1);

      // Now 3 tickets exist. Remaining capacity = 2.
      // Try to import 3 more -> should fail with capacity_exceeded
      const excessGuests = [
        { guestName: "Guest 1", guestEmail: "g1@example.com" },
        { guestName: "Guest 2", guestEmail: "g2@example.com" },
        { guestName: "Guest 3", guestEmail: "g3@example.com" },
      ];
      const r2 = await callJson(eventsHandler, {
        method: "POST",
        query: { action: "import-guests" },
        headers: { authorization: "Bearer token_alice" },
        body: { eventId, guests: excessGuests },
      });
      assert.equal(r2.code, 400);
      assert.equal(r2.body.error, "capacity_exceeded");
    });

    test("check-in scanner: valid check-in, duplicate prevention, and atomic states", async () => {
      const eventId = db._all("events")[0].id;
      const ticketsList = db._all("tickets");
      const firstTicket = ticketsList[0];
      const token = firstTicket.ticketToken;

      // 1. First check-in -> APPROVED
      {
        const r = await callJson(eventsHandler, {
          method: "POST",
          query: { action: "check-in" },
          body: {
            token,
            eventId,
            operator: "North Gate Scanner",
          },
        });
        assert.equal(r.code, 200);
        assert.equal(r.body.ok, true);
        assert.equal(r.body.code, "success");
        assert.equal(r.body.ticket.guestName, firstTicket.guestName);
      }

      // 2. Duplicate check-in with same token -> REJECTED (HTTP 409 already_checked_in)
      {
        const r = await callJson(eventsHandler, {
          method: "POST",
          query: { action: "check-in" },
          body: {
            token,
            eventId,
            operator: "South Gate Scanner",
          },
        });
        assert.equal(r.code, 409);
        assert.equal(r.body.ok, false);
        assert.equal(r.body.code, "already_checked_in");
        assert.ok(r.body.checkInTime);
        assert.equal(r.body.checkedInBy, "North Gate Scanner");
      }

      // 3. Check-in with non-existent token -> HTTP 404 invalid_ticket
      {
        const r = await callJson(eventsHandler, {
          method: "POST",
          query: { action: "check-in" },
          body: {
            token: "00000000000000000000000000000000",
            eventId,
          },
        });
        assert.equal(r.code, 404);
        assert.equal(r.body.code, "invalid_ticket");
      }

      // 4. Check-in with wrong eventId -> HTTP 400 wrong_event
      const secondTicket = ticketsList[1];
      const secondToken = secondTicket.ticketToken;
      {
        const r = await callJson(eventsHandler, {
          method: "POST",
          query: { action: "check-in" },
          body: {
            token: secondToken,
            eventId: "different_event_999",
          },
        });
        assert.equal(r.code, 400);
        assert.equal(r.body.code, "wrong_event");
      }
    });

    test("ticket revocation & regeneration", async () => {
      const ticketsList = db._all("tickets");
      const ticketId = ticketsList[1].id;
      const initialToken = ticketsList[1].ticketToken;

      // 1. Revoke ticket
      {
        const r = await callJson(eventsHandler, {
          method: "POST",
          query: { action: "revoke-ticket" },
          headers: { authorization: "Bearer token_alice" },
          body: { ticketId },
        });
        assert.equal(r.code, 200);
        assert.equal(r.body.ok, true);
        assert.equal(r.body.ticket.status, "Revoked");
      }

      // 2. Try check-in on revoked ticket -> HTTP 400 revoked
      {
        const r = await callJson(eventsHandler, {
          method: "POST",
          query: { action: "check-in" },
          body: { token: initialToken },
        });
        assert.equal(r.code, 400);
        assert.equal(r.body.code, "revoked");
      }

      // 3. Regenerate ticket
      {
        const r = await callJson(eventsHandler, {
          method: "POST",
          query: { action: "regenerate-ticket" },
          headers: { authorization: "Bearer token_alice" },
          body: { ticketId },
        });
        assert.equal(r.code, 200);
        assert.equal(r.body.ok, true);
        assert.equal(r.body.ticket.status, "Valid");
        assert.notEqual(r.body.ticket.ticketToken, initialToken);

        // Check in with new token -> APPROVED
        const r2 = await callJson(eventsHandler, {
          method: "POST",
          query: { action: "check-in" },
          body: { token: r.body.ticket.ticketToken },
        });
        assert.equal(r2.code, 200);
        assert.equal(r2.body.code, "success");
      }
    });

    test("cancelled event check-in rejection", async () => {
      const eventId = db._all("events")[0].id;
      // Mark event as Cancelled
      await db.collection("events").doc(eventId).update({ status: "Cancelled" });

      const ticketsList = db._all("tickets");
      const thirdTicket = ticketsList[2];
      const thirdToken = thirdTicket.ticketToken;

      const r = await callJson(eventsHandler, {
        method: "POST",
        query: { action: "check-in" },
        body: { token: thirdToken },
      });
      assert.equal(r.code, 400);
      assert.equal(r.body.code, "event_cancelled");
    });
  });

  // =========================================================================
  // MODULE 1 REGRESSION: EVENT TICKET MANAGEMENT ROUTING & WORKFLOW
  // =========================================================================
  describe("Event Ticket Management Dedicated Route & Workflow", () => {
    test("Manage Tickets button links to dedicated /events/:eventId/tickets route", () => {
      const eventsPageCode = fs.readFileSync("src/pages/Events.jsx", "utf8");
      // Must link directly to /events/${evt.id}/tickets
      assert.ok(
        eventsPageCode.includes("`/events/${evt.id}/tickets`"),
        "Events.jsx must render Link pointing to `/events/${evt.id}/tickets`"
      );
      assert.ok(
        !eventsPageCode.includes('onClick={() => setSearchParams({ eventId: evt.id })}'),
        "Events.jsx must not use broken searchParam mutation on Manage Tickets button"
      );
    });

    test("Dedicated route /events/:eventId/tickets and /events/:id/tickets registered in main.jsx", () => {
      const mainCode = fs.readFileSync("src/main.jsx", "utf8");
      assert.ok(
        mainCode.includes('path="/events/:eventId/tickets"'),
        "main.jsx must register /events/:eventId/tickets route"
      );
      assert.ok(
        mainCode.includes('path="/events/:id/tickets"'),
        "main.jsx must register /events/:id/tickets route"
      );
      assert.ok(
        mainCode.includes("EventTickets"),
        "main.jsx must map ticket route to EventTickets component"
      );
    });

    test("AppShell sidebar keeps Event Management active on /events/:eventId/tickets subroutes", () => {
      const appShellCode = fs.readFileSync("src/components/AppShell.jsx", "utf8");
      assert.ok(
        appShellCode.includes('item.key === "events" && location.pathname.startsWith("/events")'),
        "AppShell.jsx must keep Event Management highlighted for all /events subroutes"
      );
    });

    test("Event ticket management loads event details & tickets without redirecting to create QR", async () => {
      const db = makeDb();
      const eventsHandler = createEventsHandler({
        getDb: () => db,
        serverTs: () => new Date().toISOString(),
        verify: mockVerify,
      });

      // 1. Create an event
      const createRes = await callJson(eventsHandler, {
        method: "POST",
        query: { action: "create" },
        headers: { authorization: "Bearer token_alice" },
        body: {
          event: {
            name: "Dedicated Tickets Summit",
            venueName: "Room A",
            venueAddress: "123 Event Lane",
            eventDate: "2026-12-01",
            startTime: "10:00",
            capacity: 20,
          },
        },
      });
      assert.equal(createRes.code, 200);
      const eventId = createRes.body.event.id;

      // 2. Fetch event data as the dedicated ticket management page does
      const getRes = await callJson(eventsHandler, {
        method: "GET",
        query: { action: "get", id: eventId },
        headers: { authorization: "Bearer token_alice" },
      });
      assert.equal(getRes.code, 200);
      assert.equal(getRes.body.ok, true);
      assert.equal(getRes.body.event.id, eventId);
      assert.equal(getRes.body.event.name, "Dedicated Tickets Summit");
      assert.equal(Array.isArray(getRes.body.tickets), true);

      // 3. Issue a ticket directly from ticket management
      const ticketRes = await callJson(eventsHandler, {
        method: "POST",
        query: { action: "create-ticket" },
        headers: { authorization: "Bearer token_alice" },
        body: {
          eventId,
          guestName: "Dedicated Attendee",
          guestEmail: "attendee@example.com",
          ticketType: "VIP",
        },
      });
      assert.equal(ticketRes.code, 200);
      assert.equal(ticketRes.body.ticket.guestName, "Dedicated Attendee");

      // 4. Verify updated tickets list
      const updatedRes = await callJson(eventsHandler, {
        method: "GET",
        query: { action: "get", id: eventId },
        headers: { authorization: "Bearer token_alice" },
      });
      assert.equal(updatedRes.body.tickets.length, 1);
      assert.equal(updatedRes.body.tickets[0].guestName, "Dedicated Attendee");
    });
  });

  // =========================================================================
  // MODULE 2: PRODUCTMATE-STYLE GOOGLE REVIEW GENERATOR (ZERO EXTERNAL APIS)
  // =========================================================================
  describe("ProductMate-Style Google Review Generator (Zero External APIs)", () => {
    test("direct Place ID extraction", () => {
      const pid = "ChIJN1t_tDeuEmsRUsoyG83frY4";
      const result = extractPlaceIdLocally(pid);
      assert.equal(result, pid);
    });

    test("Place ID extraction from Google Maps URL parameters", () => {
      // 1. query_place_id parameter
      const u1 = "https://www.google.com/maps/search/?api=1&query=Google&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4";
      assert.equal(extractPlaceIdLocally(u1), "ChIJN1t_tDeuEmsRUsoyG83frY4");

      // 2. place_id parameter
      const u2 = "https://maps.google.com/?place_id=ChIJN1t_tDeuEmsRUsoyG83frY4&authuser=0";
      assert.equal(extractPlaceIdLocally(u2), "ChIJN1t_tDeuEmsRUsoyG83frY4");

      // 3. !1sChIJ... parameter in Maps data
      const u3 = "https://www.google.com/maps/place/Sydney+Opera+House/@-33.8567844,151.2152967,17z/data=!4m6!3m5!1sChIJ3S-JXmauEmsRUcIaWtf4MzE!8m2!3d-33.8567844!4d151.2152967";
      assert.equal(extractPlaceIdLocally(u3), "ChIJ3S-JXmauEmsRUcIaWtf4MzE");

      // 4. /maps/place/ChIJ...
      const u4 = "https://www.google.com/maps/place/ChIJN1t_tDeuEmsRUsoyG83frY4";
      assert.equal(extractPlaceIdLocally(u4), "ChIJN1t_tDeuEmsRUsoyG83frY4");
    });

    test("returns null for share links or generic URLs without Place ID (prevents fabrication)", () => {
      const genericUrl = "https://share.google/MfygMxeCrhahq4kAq";
      assert.equal(extractPlaceIdLocally(genericUrl), null);

      const businessNameOnly = "Graphix Circle London";
      assert.equal(extractPlaceIdLocally(businessNameOnly), null);
    });

    test("validates official direct Google review URLs", () => {
      assert.equal(
        isValidGoogleReviewUrl("https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4"),
        true
      );
      assert.equal(
        isValidGoogleReviewUrl("https://g.page/r/CbXx_customBusiness/review"),
        true
      );
      assert.equal(
        isValidGoogleReviewUrl("https://maps.google.com/?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4"),
        true
      );
      assert.equal(
        isValidGoogleReviewUrl("https://unrelated-phishing-site.com/writereview"),
        false
      );
    });

    test("zero external APIs rule: no network calls, pure local review URL construction", () => {
      const pid = "ChIJN1t_tDeuEmsRUsoyG83frY4";
      const constructed = `https://search.google.com/local/writereview?placeid=${encodeURIComponent(pid)}`;
      assert.equal(
        constructed,
        "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4"
      );
    });
  });
});
