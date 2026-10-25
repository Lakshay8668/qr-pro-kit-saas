// api/_lib/handler.js
// The server-side redirect for every scan:  /q/:id  ->  /api/q/:id
//
// Why server-side (vs the v5 browser redirect):
//  * expiry / pause / scan-limit / password are ENFORCED here, not just hidden in the UI
//  * real country + city from Vercel's edge headers (browsers can't see the IP)
//  * password hash and destinations are no longer publicly readable from Firestore
//  * faster scans (one hop, no SPA bundle download)
//
// `deps` is injected so the handler can be unit-tested without Firebase.

import crypto from "node:crypto";
import { parseUA, isBot } from "./ua.js";
import { messagePage, passwordPage, bioPage } from "./pages.js";

const SAFE_ID = /^[A-Za-z0-9_-]{3,60}$/;
const isHttp = (u) => typeof u === "string" && /^https?:\/\//i.test(u) && (() => { try { new URL(u); return true; } catch { return false; } })();
const attempts = new Map(); // best-effort brute-force limiter (per warm instance)

function parseCookies(h = "") {
  const out = {};
  h.split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) {
      const v = p.slice(i + 1).trim();
      try { out[p.slice(0, i).trim()] = decodeURIComponent(v); } catch { out[p.slice(0, i).trim()] = v; }
    }
  });
  return out;
}

async function readForm(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  let raw = typeof req.body === "string" ? req.body : "";
  if (!raw && typeof req.on === "function") {
    raw = await new Promise((res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => res(b));
      req.on("error", () => res(""));
    });
  }
  return Object.fromEntries(new URLSearchParams(raw.slice(0, 2000)));
}

const send = (res, code, html, extra = {}) => {
  res.statusCode = code;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; form-action 'self'; base-uri 'none'");
  Object.entries(extra).forEach(([k, v]) => res.setHeader(k, v));
  res.end(html);
};

const redirect = (res, url, code = 302, extra = {}) => {
  res.statusCode = code;
  res.setHeader("Location", url);
  res.setHeader("Cache-Control", "no-store");
  Object.entries(extra).forEach(([k, v]) => res.setHeader(k, v));
  res.end();
};

export function createHandler(deps) {
  const { getDb, increment, serverTs, secret, quota, now = () => Date.now() } = deps; // quota: optional { check(ownerId), record(ownerId) } (api/_lib/quota.js)

  const sign = (id, exp) => crypto.createHmac("sha256", secret()).update(`${id}.${exp}`).digest("hex").slice(0, 32);
  const makeToken = (id, ttlMs = 3600_000) => {
    const exp = now() + ttlMs;
    return `${exp}.${sign(id, exp)}`;
  };
  const tokenOk = (id, tok = "") => {
    const [exp, sig] = String(tok).split(".");
    if (!exp || !sig || Number(exp) < now()) return false;
    const good = sign(id, exp);
    return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
  };

  function passwordMatches(pw, spec) {
    try {
      const iter = Math.min(Number(spec.iter) || 100000, 310000);
      const h = crypto.pbkdf2Sync(String(pw), Buffer.from(spec.salt, "hex"), iter, 32, "sha256");
      const want = Buffer.from(spec.hash, "hex");
      return want.length === h.length && crypto.timingSafeEqual(h, want);
    } catch {
      return false;
    }
  }

  return async function handler(req, res) {
    if (!["GET", "HEAD", "POST"].includes(req.method)) return send(res, 405, messagePage("Not allowed", "Method not allowed."));

    const id = String(req.query?.id || "");
    if (!SAFE_ID.test(id)) return send(res, 404, messagePage("This QR code isn't active", "The link it pointed to may have been removed or is invalid."));

    let ref, data;
    try {
      ref = getDb().collection("links").doc(id);
      let snap = await ref.get();
      if (!snap.exists) {
        const col = getDb().collection("links");
        if (typeof col.where === "function") {
          const slugQuery = await col.where("slug", "==", id).limit(1).get();
          if (slugQuery && !slugQuery.empty) {
            snap = slugQuery.docs[0];
            ref = snap.ref;
          } else {
            return send(res, 404, messagePage("This QR code isn't active", "The link it pointed to may have been removed or is invalid."));
          }
        } else {
          return send(res, 404, messagePage("This QR code isn't active", "The link it pointed to may have been removed or is invalid."));
        }
      }
      data = snap.data();
    } catch (e) {
      console.error("link lookup failed", e);
      return send(res, 500, messagePage("Couldn't load this QR code", "Please scan again in a moment."));
    }

    // Static QR codes are only saved in the owner's dashboard; they are not hosted links.
    if (data.kind === "static") return send(res, 404, messagePage("This QR code isn't active", "The link it pointed to may have been removed or is invalid."));

    // ---- enforced controls
    if (data.active === false) return send(res, 403, messagePage("This QR code is paused", "The owner has temporarily turned this QR off. Please check back later."));
    const exp = data.expiresAt?.toMillis?.() ?? (typeof data.expiresAt === "number" ? data.expiresAt : 0);
    if (exp && exp < now()) return send(res, 410, messagePage("This QR code has expired", "The campaign linked to this QR code has ended."));
    if (data.maxScans && (data.scans || 0) >= data.maxScans) return send(res, 429, messagePage("Scan limit reached", "The owner set a maximum number of scans and it has been reached."));

    // ---- plan quota: monthly scans for the QR's owner (api/_lib/quota.js)
    if (quota && data.ownerId) {
      const q = await quota.check(data.ownerId);
      if (!q.ok) return send(res, 429, messagePage("Monthly scan limit reached", "This QR code has used up its monthly scan allowance. The owner can upgrade their plan to turn it back on."));
    }

    const cookies = parseCookies(req.headers.cookie || "");
    const setCookies = [];

    // ---- password gate
    if (data.password?.hash) {
      const ok = tokenOk(id, cookies[`qra_${id}`]);
      if (!ok) {
        if (req.method === "POST") {
          const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "ip";
          const key = `${id}|${ip}`;
          const a = attempts.get(key) || { n: 0, t: now() };
          if (now() - a.t > 600_000) { a.n = 0; a.t = now(); }
          if (a.n >= 8) return send(res, 429, messagePage("Too many attempts", "Please wait 10 minutes and try again."));
          const form = await readForm(req);
          if (passwordMatches(form.password || "", data.password)) {
            attempts.delete(key);
            const redirectPrefix = req.url && req.url.startsWith("/r/") ? "/r/" : "/q/";
            return redirect(res, `${redirectPrefix}${encodeURIComponent(id)}`, 303, {
              "Set-Cookie": `qra_${id}=${makeToken(id)}; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Lax`,
            });
          }
          a.n++;
          attempts.set(key, a);
          await new Promise((r) => setTimeout(r, 700));
          return send(res, 401, passwordPage({ error: "Wrong password. Try again." }));
        }
        return send(res, 200, passwordPage());
      }
    } else if (req.method === "POST") {
      const redirectPrefix = req.url && req.url.startsWith("/r/") ? "/r/" : "/q/";
      return redirect(res, `${redirectPrefix}${encodeURIComponent(id)}`, 303);
    }

    // ---- decide target
    const ua = req.headers["user-agent"] || "";
    const info = parseUA(ua);
    const kind = data.kind || "redirect";
    const go = req.query?.go;
    let ev = "scan";
    let target = null;
    let clickTarget = "";
    let html = null;

    if (kind === "bio") {
      if (go !== undefined) {
        const i = Number(go);
        const l = Number.isInteger(i) ? data.bio?.links?.[i] : null;
        if (!l || !isHttp(l.url)) return send(res, 404, messagePage("Link not found", "This link is no longer available."));
        ev = "click";
        target = l.url;
        clickTarget = String(l.label || l.url).slice(0, 60);
      } else {
        html = bioPage(id, data.bio || {});
      }
    } else {
      target = data.destination;
      if (info.os === "iOS" && isHttp(data.destinations?.ios)) target = data.destinations.ios;
      else if (info.os === "Android" && isHttp(data.destinations?.android)) target = data.destinations.android;
      if (!isHttp(target)) return send(res, 404, messagePage("This QR code isn't active", "The destination is invalid."));
    }

    // ---- log (skip bots / HEAD)
    if (req.method === "GET" && !isBot(ua)) {
      let vid = cookies.qrv;
      if (!vid || !/^[a-z0-9]{8,24}$/.test(vid)) {
        vid = crypto.randomBytes(8).toString("hex");
        setCookies.push(`qrv=${vid}; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Lax`);
      }
      const h = req.headers;
      let city = "";
      try { city = decodeURIComponent(h["x-vercel-ip-city"] || ""); } catch { city = h["x-vercel-ip-city"] || ""; }
      const rec = {
        ts: serverTs(),
        ev,
        device: info.device,
        os: info.os,
        browser: info.browser,
        lang: String(h["accept-language"] || "").split(",")[0].slice(0, 16),
        country: String(h["x-vercel-ip-country"] || "").slice(0, 2).toUpperCase(),
        region: String(h["x-vercel-ip-country-region"] || "").slice(0, 32),
        city: city.slice(0, 64),
        referer: String(h.referer || h.referrer || "").slice(0, 200),
        ua: String(ua || "").slice(0, 200),
        vid,
      };
      if (ev === "click") rec.target = clickTarget;
      const writes = [ref.collection("scans").add(rec)];
      if (ev === "scan") {
        writes.push(ref.update({ scans: increment(1), lastScannedAt: serverTs() }));
        if (quota && data.ownerId) writes.push(quota.record(data.ownerId));
      }
      await Promise.allSettled(writes);
    }

    const extra = setCookies.length ? { "Set-Cookie": setCookies } : {};
    if (html) return send(res, 200, html, extra);
    return redirect(res, target, 302, extra);
  };
}
