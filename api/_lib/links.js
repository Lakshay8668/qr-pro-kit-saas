// api/_lib/links.js — the ONLY way links are created (firestore.rules deny client-side creates).
// This is where plan limits are enforced, because the browser can't be trusted with that.
//
// POST ?action=create       { link: {...} }            -> { id }
// POST ?action=create-many  { items: [{...}, ...] }    -> { ids }   (bulk; needs the "bulk" feature)
//
// Errors are JSON: { error: <code>, message, upgrade?: true, limit?, max?, used?, plan? }

import crypto from "node:crypto";
import { entitlementsFor, PLANS, LIMIT_LABELS } from "../../shared/plans.js";
import { countLinks } from "./quota.js";
import { cleanBio, cleanDesign, cleanDestinations, cleanMax, cleanPasswordSpec, isHttpUrl } from "../../shared/linkClean.js";
import { ensureUser } from "./userStore.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const MAX_BULK = 200;
const KINDS = ["redirect", "bio", "static"];

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

const randomId = (len = 7) => [...crypto.randomBytes(len)].map((b) => ALPHABET[b % ALPHABET.length]).join("");
const alreadyExists = (e) => e?.code === 6 || e?.code === "already-exists" || /already exists/i.test(e?.message || "");

export function createLinksHandler({ getDb, verify, serverTs, now = () => Date.now(), newId = randomId }) {
  const locked = (ent, feature, what) => {
    if (!ent[feature]) {
      throw new Fail(402, "feature_locked", `${what} isn't included in the ${PLANS[ent.plan].name} plan. Upgrade to use it.`, {
        upgrade: true, feature, plan: ent.plan,
      });
    }
  };

  const limitFail = (ent, limit, used, extra = "") =>
    new Fail(
      402,
      "limit_reached",
      `Your ${PLANS[ent.plan].name} plan includes ${ent[limit].toLocaleString("en-IN")} ${LIMIT_LABELS[limit]} and you've used ${used.toLocaleString("en-IN")}.${extra} Upgrade for more.`,
      { upgrade: true, limit, max: ent[limit], used, plan: ent.plan }
    );

  /** Validate one raw link from the browser and turn it into a Firestore document (or throw Fail). */
  function buildDoc(raw, uid, ent) {
    raw = raw && typeof raw === "object" ? raw : {};
    const kind = raw.kind || "redirect";
    if (!KINDS.includes(kind)) throw new Fail(400, "bad_request", "Unknown QR kind.");
    const type = /^[a-z0-9_-]{1,24}$/i.test(raw.type || "") ? raw.type : "url";
    const dest = String(raw.destination || "").trim();
    try {
      let destination = "";
      let payload = null;
      let destinations = null;
      let bio = null;
      if (kind === "static") {
        payload = String(raw.payload || "").trim();
        if (!payload) throw new Error("Nothing to save.");
        payload = payload.slice(0, 4000);
      } else if (kind === "redirect") {
        if (!isHttpUrl(dest)) throw new Error("Destination must be a valid http or https URL.");
        destination = dest;
        destinations = cleanDestinations(raw.destinations);
        if (destinations) locked(ent, "deviceTargeting", "Per-device redirects");
      } else {
        bio = cleanBio(raw.bio);
      }
      const password = kind === "static" ? null : cleanPasswordSpec(raw.password);
      if (password) locked(ent, "password", "Password protection");

      let expiresAt = null;
      if (raw.expiresAt) {
        const ms = Number(raw.expiresAt);
        if (!Number.isFinite(ms)) throw new Error("Invalid expiry date.");
        expiresAt = new Date(ms);
      }
      return {
        kind, destination, payload, destinations, bio, password,
        label: String(raw.label || "").trim().slice(0, 120) || "Untitled",
        type,
        design: cleanDesign(raw.design),
        scans: 0,
        active: true,
        expiresAt,
        maxScans: kind === "static" ? null : cleanMax(raw.maxScans),
        ownerId: uid,
        createdAt: serverTs(),
      };
    } catch (e) {
      if (e instanceof Fail) throw e;
      throw new Fail(400, "bad_request", e.message || "Invalid QR data.");
    }
  }

  async function writeOne(db, doc) {
    for (let i = 0; i < 6; i++) {
      const id = newId();
      try {
        await db.collection("links").doc(id).create(doc);
        return id;
      } catch (e) {
        if (!alreadyExists(e) || i === 5) throw e;
      }
    }
  }

  async function writeMany(db, docs) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ids = new Set();
      while (ids.size < docs.length) ids.add(newId());
      const list = [...ids];
      const batch = db.batch();
      docs.forEach((d, i) => batch.create(db.collection("links").doc(list[i]), d));
      try {
        await batch.commit();
        return list;
      } catch (e) {
        if (!alreadyExists(e) || attempt === 1) throw e;
      }
    }
  }

  return async function handler(req, res) {
    try {
      const action = String(req.query?.action || "");
      if (req.method === "GET") {
        if (!["list", "get", "scans"].includes(action)) {
          return json(res, 405, { error: "method_not_allowed" });
        }
      } else if (req.method !== "POST") {
        return json(res, 405, { error: "method_not_allowed" });
      }

      const token = String(req.headers.authorization || req.headers.Authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { error: "sign_in_required", message: "Please sign in first." });
      let me;
      try {
        me = await verify(token);
      } catch {
        return json(res, 401, { error: "bad_token", message: "Your session expired — sign in again." });
      }

      const db = getDb();
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

      const user = (await ensureUser(db, me, serverTs)) || {};
      if (user.disabled) return json(res, 403, { error: "account_disabled", message: "This account has been disabled." });
      const ent = entitlementsFor(user, now());

      // ------------------------------------------------------------- GET: list links
      if (req.method === "GET" && action === "list") {
        const snap = await db.collection("links").where("ownerId", "==", me.uid).get();
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => {
          const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tb - ta;
        });
        return json(res, 200, { links: rows });
      }

      // ------------------------------------------------------------- GET: single link
      if (req.method === "GET" && action === "get") {
        const id = String(req.query?.id || "");
        if (!id) throw new Fail(400, "bad_request", "Missing link ID.");
        const snap = await db.collection("links").doc(id).get();
        if (!snap.exists) throw new Fail(404, "not_found", "Link not found.");
        const data = snap.data();
        if (data.ownerId !== me.uid) throw new Fail(403, "forbidden", "Access denied.");
        return json(res, 200, { link: { id: snap.id, ...data } });
      }

      // ------------------------------------------------------------- GET: scan history
      if (req.method === "GET" && action === "scans") {
        const id = String(req.query?.id || "");
        if (!id) throw new Fail(400, "bad_request", "Missing link ID.");
        const snap = await db.collection("links").doc(id).get();
        if (!snap.exists) throw new Fail(404, "not_found", "Link not found.");
        if (snap.data().ownerId !== me.uid) throw new Fail(403, "forbidden", "Access denied.");
        const scansSnap = await db.collection("links").doc(id).collection("scans").orderBy("ts", "desc").limit(2000).get();
        const rows = (scansSnap.docs || []).map((d) => {
          const v = d.data();
          return { id: d.id, ...v, t: v.ts?.toMillis ? v.ts.toMillis() : typeof v.ts === "number" ? v.ts : Date.now() };
        });
        return json(res, 200, { scans: rows });
      }

      // ------------------------------------------------------------- POST: create link
      if (req.method === "POST" && action === "create") {
        const doc = buildDoc(body.link, me.uid, ent);
        const used = await countLinks(db, me.uid);
        const key = doc.kind === "static" ? "staticQrs" : "dynamicQrs";
        if (used[key] >= ent[key]) throw limitFail(ent, key, used[key]);
        return json(res, 200, { id: await writeOne(db, doc) });
      }

      // ------------------------------------------------------------- POST: bulk create
      if (req.method === "POST" && action === "create-many") {
        locked(ent, "bulk", "Bulk creation");
        const items = Array.isArray(body.items) ? body.items : [];
        if (!items.length) throw new Fail(400, "bad_request", "No rows to create.");
        if (items.length > MAX_BULK) throw new Fail(400, "bad_request", `Max ${MAX_BULK} rows per batch.`);
        const docs = items.map((it) => {
          if ((it?.kind || "redirect") !== "redirect") throw new Fail(400, "bad_request", "Bulk only supports redirect QR codes.");
          return buildDoc(it, me.uid, ent);
        });
        const used = await countLinks(db, me.uid);
        if (used.dynamicQrs + docs.length > ent.dynamicQrs) {
          const left = Math.max(0, ent.dynamicQrs - used.dynamicQrs);
          throw limitFail(ent, "dynamicQrs", used.dynamicQrs, ` This batch needs ${docs.length} but only ${left} are left.`);
        }
        return json(res, 200, { ids: await writeMany(db, docs) });
      }

      // ------------------------------------------------------------- POST: update link
      if (req.method === "POST" && action === "update") {
        const id = String(body.id || req.query?.id || "");
        if (!id) throw new Fail(400, "bad_request", "Missing link ID.");
        const ref = db.collection("links").doc(id);
        const snap = await ref.get();
        if (!snap.exists) throw new Fail(404, "not_found", "Link not found.");
        const cur = snap.data();
        if (cur.ownerId !== me.uid) throw new Fail(403, "forbidden", "Access denied.");

        const patch = body.patch || {};
        const out = {};
        if ("label" in patch) out.label = String(patch.label || "").trim().slice(0, 120) || "Untitled";
        if ("destination" in patch) {
          const dest = String(patch.destination || "").trim();
          if (!isHttpUrl(dest)) throw new Fail(400, "bad_request", "Destination must be a valid http or https URL.");
          out.destination = dest;
        }
        if ("destinations" in patch) {
          const cd = cleanDestinations(patch.destinations);
          if (cd) locked(ent, "deviceTargeting", "Per-device redirects");
          out.destinations = cd;
        }
        if ("bio" in patch) out.bio = cleanBio(patch.bio);
        if ("payload" in patch) out.payload = String(patch.payload || "").slice(0, 4000);
        if ("password" in patch) {
          const p = cleanPasswordSpec(patch.password);
          if (p) locked(ent, "password", "Password protection");
          out.password = p;
        }
        if ("active" in patch) out.active = Boolean(patch.active);
        if ("expiresAt" in patch) {
          const ms = patch.expiresAt ? new Date(patch.expiresAt).getTime() : null;
          out.expiresAt = ms ? new Date(ms) : null;
        }
        if ("maxScans" in patch) out.maxScans = cleanMax(patch.maxScans);
        if ("design" in patch) out.design = cleanDesign(patch.design);

        await ref.update(out);
        return json(res, 200, { ok: true, id });
      }

      // ------------------------------------------------------------- POST: delete link
      if (req.method === "POST" && action === "delete") {
        const id = String(body.id || req.query?.id || "");
        if (!id) throw new Fail(400, "bad_request", "Missing link ID.");
        const ref = db.collection("links").doc(id);
        const snap = await ref.get();
        if (!snap.exists) return json(res, 200, { ok: true });
        const cur = snap.data();
        if (cur.ownerId !== me.uid) throw new Fail(403, "forbidden", "Access denied.");

        try {
          const scansRef = db.collection("links").doc(id).collection("scans");
          const scansSnap = await scansRef.get();
          if (scansSnap.docs?.length) {
            const batch = db.batch();
            scansSnap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
          }
        } catch {}

        await ref.delete();
        return json(res, 200, { ok: true, id });
      }

      return json(res, 400, { error: "unknown_action" });
    } catch (e) {
      if (e instanceof Fail) return json(res, e.status, e.body);
      console.error("links api error", e);
      return json(res, 500, { error: "server_error", message: "Something went wrong. Please try again." });
    }
  };
}
