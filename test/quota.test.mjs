// Run: node test/quota.test.mjs  — monthly scan quota enforced inside the real redirect handler.
import assert from "node:assert/strict";
import { createHandler } from "../api/_lib/handler.js";
import { createQuota, usageId } from "../api/_lib/quota.js";
import { makeDb, inc, callJson } from "./fakeDb.mjs";

const DAY = 86400000;
let T = Date.UTC(2026, 9, 11, 12);
let n = 0;
const ok = (m) => console.log(`  ✓ ${m}`) || n++;

const db = makeDb({
  users: {
    freeOwner: { email: "f@x.com" },
    proOwner: { plan: "pro", planStatus: "active", currentPeriodEnd: T + 20 * DAY },
    lapsed: { plan: "pro", planStatus: "canceled", currentPeriodEnd: T - DAY },
  },
  links: {
    freeLnk: { destination: "https://free.example/x", ownerId: "freeOwner", scans: 0, kind: "redirect" },
    proLnk: { destination: "https://pro.example/x", ownerId: "proOwner", scans: 0, kind: "redirect" },
    lapsedLnk: { destination: "https://lapsed.example/x", ownerId: "lapsed", scans: 0, kind: "redirect" },
    legacy1: { destination: "https://legacy.example/x", scans: 0 }, // no ownerId (very old link) -> no quota
  },
  usage: {},
});
const quota = createQuota({ getDb: () => db, increment: inc, serverTs: () => "TS", now: () => T });
const handler = createHandler({ getDb: () => db, secret: () => "s", increment: inc, serverTs: () => "TS", now: () => T, quota });
const scan = (id, o = {}) => callJson(handler, { headers: { "user-agent": "Mozilla/5.0 (Linux; Android 14) Mobile Chrome/120", ...(o.headers || {}) }, query: { id }, method: o.method || "GET" });
const used = (uid) => db._get("usage", usageId(uid, T))?.scans || 0;

let r = await scan("freeLnk");
assert.equal(r.code, 302); assert.equal(used("freeOwner"), 1); assert.equal(db._get("links", "freeLnk").scans, 1); ok("a scan redirects and counts against the owner's monthly usage");

r = await callJson(handler, { headers: { "user-agent": "Googlebot/2.1" }, query: { id: "freeLnk" } });
assert.equal(r.code, 302); r = await scan("freeLnk", { method: "HEAD" });
assert.equal(used("freeOwner"), 1); ok("bots and HEAD requests are not counted");

await db.collection("usage").doc(usageId("freeOwner", T)).set({ scans: 499 });
r = await scan("freeLnk"); assert.equal(r.code, 302); assert.equal(used("freeOwner"), 500);
r = await scan("freeLnk");
assert.equal(r.code, 429); assert.match(r.raw, /Monthly scan limit reached/); assert.ok(!r.headers.Location); assert.equal(used("freeOwner"), 500, "blocked scans don't increment"); ok("free plan: the 501st scan of the month is blocked with a clear page");

r = await scan("proLnk"); assert.equal(r.code, 302);
await db.collection("usage").doc(usageId("proOwner", T)).set({ scans: 19999 });
r = await scan("proLnk"); assert.equal(r.code, 302); r = await scan("proLnk"); assert.equal(r.code, 429); ok("pro plan: 20,000 scans/month");

r = await scan("lapsedLnk"); assert.equal(r.code, 302);
await db.collection("usage").doc(usageId("lapsed", T)).set({ scans: 500 });
r = await scan("lapsedLnk"); assert.equal(r.code, 429); ok("lapsed subscription falls back to the free allowance");

r = await scan("legacy1"); assert.equal(r.code, 302); ok("very old links without an owner are never quota-blocked");

T += 21 * DAY; // 1st November UTC
r = await scan("freeLnk"); assert.equal(r.code, 302); assert.equal(used("freeOwner"), 1); ok("allowance resets on the 1st of the next month (UTC)");

// fail-open
const brokenDb = { collection: (name) => ({ doc: () => ({ get: async () => { if (name === "usage") throw new Error("firestore down"); return { exists: false, data: () => ({}) }; } }) }) };
const q2 = createQuota({ getDb: () => brokenDb, increment: inc, serverTs: () => "TS", now: () => T });
const origErr = console.error; console.error = () => {};
const c = await q2.check("anyone"); console.error = origErr;
assert.equal(c.ok, true); ok("if the quota lookup fails, the scan is let through (printed QR codes keep working)");

// other enforced controls still win
db.collection("links").doc("pausedLnk").set({ destination: "https://p.example", ownerId: "proOwner", active: false, scans: 0 });
r = await scan("pausedLnk"); assert.equal(r.code, 403); ok("existing pause/expiry/limit controls still enforced before quota");

console.log(`\n${n} quota checks passed`);
