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
import { isAdminUid } from "./adminAuth.js";
import { resolveGoogleMapsUrl } from "./googleReview.js";

export function getPublicBaseUrl() {
  const env = process.env;
  return (
    env.PUBLIC_BASE_URL ||
    env.VITE_PUBLIC_BASE_URL ||
    (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : "") ||
    "https://qr-pro-kit-saas-production.up.railway.app"
  ).replace(/\/+$/, "");
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const MAX_BULK = 200;
const KINDS = ["redirect", "bio", "static"];

export const RESERVED_SLUGS = new Set([
  "api", "dashboard", "events", "reviews", "shortlinks", "short-links",
  "checkin", "login", "admin", "bulk", "billing", "pricing", "links",
  "s", "q", "r", "health", "assets", "favicon", "favicon.ico", "manifest",
  "robots", "robots.txt", "static", "draft", "scan", "qr", "auth",
  "overview", "create", "analytics", "folders", "settings", "help",
]);

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

export function createLinksHandler({ getDb, verify, serverTs, now = () => Date.now(), newId = randomId, adminUids }) {
  const locked = (ent, feature, what) => {
    if (ent.isAdmin) return;
    if (!ent[feature]) {
      throw new Fail(402, "feature_locked", `${what} isn't included in the ${PLANS[ent.plan]?.name || "Free"} plan. Upgrade to use it.`, {
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
      let slug = null;
      if (kind !== "static" && raw.slug !== undefined && raw.slug !== null && String(raw.slug).trim() !== "") {
        const candidate = String(raw.slug).trim();
        if (!/^[A-Za-z0-9_-]{3,60}$/.test(candidate)) {
          throw new Fail(400, "bad_request", "Slug must be 3-60 alphanumeric characters, hyphens, or underscores.");
        }
        if (RESERVED_SLUGS.has(candidate.toLowerCase())) {
          throw new Fail(400, "reserved_slug", `"${candidate}" is a reserved system path and cannot be used as a short link slug.`);
        }
        slug = candidate;
      }
      const base = getPublicBaseUrl();
      const prefix = raw.prefix === "s" ? "s" : "r";
      const active = raw.active !== false;
      return {
        kind, destination, payload, destinations, bio, password,
        label: String(raw.label || "").trim().slice(0, 120) || "Untitled",
        type,
        design: cleanDesign(raw.design),
        scans: 0,
        active,
        expiresAt,
        maxScans: kind === "static" ? null : cleanMax(raw.maxScans),
        ownerId: uid,
        slug: slug || null,
        shortUrl: slug ? `${base}/${prefix}/${slug}` : null,
        prefix,
        createdAt: serverTs(),
      };
    } catch (e) {
      if (e instanceof Fail) throw e;
      throw new Fail(400, "bad_request", e.message || "Invalid QR data.");
    }
  }

  async function writeOne(db, doc) {
    const isDynamic = doc.kind !== "static";
    const base = getPublicBaseUrl();
    const prefix = doc.prefix === "s" ? "s" : "r";

    if (isDynamic && doc.slug) {
      try {
        const colQuery = await db.collection("links").where("slug", "==", doc.slug).limit(1).get();
        if (!colQuery.empty) {
          throw new Fail(409, "slug_taken", `The short link slug "${doc.slug}" is already in use. Please choose another.`);
        }
      } catch (e) {
        if (e instanceof Fail) throw e;
      }
      doc.shortUrl = `${base}/${prefix}/${doc.slug}`;
      const id = newId();
      await db.collection("links").doc(id).create(doc);
      return { id, slug: doc.slug, shortUrl: doc.shortUrl };
    }

    for (let i = 0; i < 6; i++) {
      const id = newId();
      if (isDynamic) {
        if (!doc.slug) doc.slug = id;
        doc.shortUrl = `${base}/${prefix}/${doc.slug}`;
        // Collision check: verify no other link has this slug
        try {
          const colQuery = await db.collection("links").where("slug", "==", doc.slug).limit(1).get();
          if (!colQuery.empty) {
            doc.slug = null;
            continue;
          }
        } catch {}
      }
      try {
        await db.collection("links").doc(id).create(doc);
        return { id, slug: doc.slug, shortUrl: doc.shortUrl };
      } catch (e) {
        if (isDynamic) doc.slug = null;
        if (!alreadyExists(e) || i === 5) throw e;
      }
    }
  }

  async function writeMany(db, docs) {
    const CHUNK_SIZE = 400;
    const allIds = [];
    const base = getPublicBaseUrl();
    for (let offset = 0; offset < docs.length; offset += CHUNK_SIZE) {
      const slice = docs.slice(offset, offset + CHUNK_SIZE);
      let committed = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const ids = new Set();
        while (ids.size < slice.length) ids.add(newId());
        const list = [...ids];
        const batch = db.batch();
        slice.forEach((d, i) => {
          const id = list[i];
          if (d.kind !== "static") {
            if (!d.slug) d.slug = id;
            d.shortUrl = `${base}/r/${d.slug}`;
          }
          batch.create(db.collection("links").doc(id), d);
        });
        try {
          await batch.commit();
          allIds.push(...list);
          committed = true;
          break;
        } catch (e) {
          if (!alreadyExists(e) || attempt === 2) throw e;
        }
      }
      if (!committed) throw new Error("Batch write commit failed.");
    }
    return allIds;
  }

  return async function handler(req, res) {
    try {
      const action = String(req.query?.action || "");

      // ------------------------------------------------------------- PUBLIC: resolve Google Review URL
      if (action === "resolve-google-review") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
        const urlToResolve = body.maps_url || body.url || body.input || req.query?.url || "";
        const result = await resolveGoogleMapsUrl(urlToResolve);
        const statusCode = result.ok
          ? 200
          : result.code === "invalid_request"
          ? 400
          : result.code === "upstream_timeout"
          ? 504
          : 422;
        return json(res, statusCode, result);
      }

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

      const isAdmin = adminUids ? (typeof adminUids === "function" ? adminUids() : adminUids).includes(me.uid) : isAdminUid(me.uid);
      const user = (await ensureUser(db, me, serverTs)) || {};
      if (isAdmin) user.isAdmin = true;
      if (user.disabled && !isAdmin) return json(res, 403, { error: "account_disabled", message: "This account has been disabled." });
      const ent = entitlementsFor(user, now());

      // ------------------------------------------------------------- GET: list links
      if (req.method === "GET" && action === "list") {
        const snap = await db.collection("links").where("ownerId", "==", me.uid).get();
        const base = getPublicBaseUrl();
        const rows = snap.docs.map((d) => {
          const data = d.data();
          const row = { id: d.id, ...data };
          if (row.kind !== "static" && !row.shortUrl) {
            const s = row.slug || row.id;
            row.slug = s;
            row.shortUrl = `${base}/r/${s}`;
          }
          return row;
        });
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
        if (data.ownerId !== me.uid && !isAdmin) throw new Fail(403, "forbidden", "Access denied.");
        const row = { id: snap.id, ...data };
        if (row.kind !== "static" && !row.shortUrl) {
          const s = row.slug || row.id;
          row.slug = s;
          row.shortUrl = `${getPublicBaseUrl()}/r/${s}`;
        }
        return json(res, 200, { link: row });
      }

      // ------------------------------------------------------------- GET: scan history
      if (req.method === "GET" && action === "scans") {
        const id = String(req.query?.id || "");
        if (!id) throw new Fail(400, "bad_request", "Missing link ID.");
        const snap = await db.collection("links").doc(id).get();
        if (!snap.exists) throw new Fail(404, "not_found", "Link not found.");
        if (snap.data().ownerId !== me.uid && !isAdmin) throw new Fail(403, "forbidden", "Access denied.");
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
        if (!isAdmin && used[key] >= ent[key]) throw limitFail(ent, key, used[key]);
        const result = await writeOne(db, doc);
        return json(res, 200, {
          id: result.id,
          slug: result.slug || result.id,
          shortUrl: result.shortUrl || (doc.kind !== "static" ? `${getPublicBaseUrl()}/r/${result.id}` : null),
        });
      }

      // ------------------------------------------------------------- POST: bulk create
      if (req.method === "POST" && action === "create-many") {
        locked(ent, "bulk", "Bulk creation");
        const items = Array.isArray(body.items) ? body.items : [];
        if (!items.length) throw new Fail(400, "bad_request", "No rows to create.");
        const maxBatch = isAdmin ? 1000 : MAX_BULK;
        if (items.length > maxBatch) throw new Fail(400, "bad_request", `Max ${maxBatch} rows per batch.`);
        const docs = items.map((it) => {
          if ((it?.kind || "redirect") !== "redirect") throw new Fail(400, "bad_request", "Bulk only supports redirect QR codes.");
          return buildDoc(it, me.uid, ent);
        });
        const used = await countLinks(db, me.uid);
        if (!isAdmin && used.dynamicQrs + docs.length > ent.dynamicQrs) {
          const left = Math.max(0, ent.dynamicQrs - used.dynamicQrs);
          throw limitFail(ent, "dynamicQrs", used.dynamicQrs, ` This batch needs ${docs.length} but only ${left} are left.`);
        }
        return json(res, 200, { ids: await writeMany(db, docs) });
      }

      // ------------------------------------------------------------- POST: bulk quantity
      if (req.method === "POST" && action === "bulk-quantity") {
        locked(ent, "bulk", "Bulk creation");

        // Parse and validate quantity range inputs
        let minQty = body.minQuantity !== undefined ? parseInt(body.minQuantity, 10) : 10;
        let maxQty = body.maxQuantity !== undefined ? parseInt(body.maxQuantity, 10) : 1000;
        let qty = body.quantity !== undefined ? parseInt(body.quantity, 10) : minQty;

        if (!Number.isInteger(minQty) || minQty < 10 || minQty > 1000) {
          throw new Fail(400, "bad_request", "Minimum quantity must be an integer between 10 and 1,000.");
        }
        if (!Number.isInteger(maxQty) || maxQty < 10 || maxQty > 1000) {
          throw new Fail(400, "bad_request", "Maximum quantity must be an integer between 10 and 1,000.");
        }
        if (minQty > maxQty) {
          throw new Fail(400, "bad_request", `Minimum quantity (${minQty}) cannot be greater than maximum quantity (${maxQty}).`);
        }
        if (!Number.isInteger(qty) || qty < minQty || qty > maxQty) {
          throw new Fail(400, "bad_request", `Requested generation quantity (${qty}) must be between 10 and 1,000 (specified range: ${minQty} to ${maxQty}).`);
        }

        const used = await countLinks(db, me.uid);
        if (!isAdmin && used.dynamicQrs + qty > ent.dynamicQrs) {
          const left = Math.max(0, ent.dynamicQrs - used.dynamicQrs);
          throw limitFail(ent, "dynamicQrs", used.dynamicQrs, ` Generating ${qty} QR codes exceeds your remaining allowance of ${left}.`);
        }

        const defaultDest = isHttpUrl(body.defaultDestination)
          ? body.defaultDestination.trim()
          : "https://qr-pro-kit-saas-production.up.railway.app/draft";
        const baseLabel = String(body.labelPrefix || body.prefix || "QR").trim().slice(0, 50) || "QR";
        const cleanDes = cleanDesign(body.design);
        const docs = [];
        for (let i = 1; i <= qty; i++) {
          docs.push({
            kind: "redirect",
            destination: defaultDest,
            payload: null,
            destinations: null,
            bio: null,
            password: null,
            label: `${baseLabel} #${i}`,
            type: "url",
            design: cleanDes,
            scans: 0,
            active: true,
            expiresAt: null,
            maxScans: null,
            isDraft: true,
            ownerId: me.uid,
            createdAt: serverTs(),
          });
        }
        return json(res, 200, {
          ids: await writeMany(db, docs),
          quantity: qty,
          minQuantity: minQty,
          maxQuantity: maxQty,
        });
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
        if ("slug" in patch && patch.slug) {
          const s = String(patch.slug).trim();
          if (!/^[A-Za-z0-9_-]{3,60}$/.test(s)) throw new Fail(400, "bad_request", "Slug must be 3-60 alphanumeric characters, hyphens, or underscores.");
          if (RESERVED_SLUGS.has(s.toLowerCase())) {
            throw new Fail(400, "reserved_slug", `"${s}" is a reserved system path and cannot be used as a short link slug.`);
          }
          const colQuery = await db.collection("links").where("slug", "==", s).limit(1).get();
          if (!colQuery.empty && colQuery.docs[0].id !== id) {
            throw new Fail(409, "slug_taken", "This short link slug is already taken.");
          }
          out.slug = s;
          const pref = cur.prefix === "s" ? "s" : "r";
          out.shortUrl = `${getPublicBaseUrl()}/${pref}/${s}`;
        }

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
