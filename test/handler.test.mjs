// Run:  node test/handler.test.mjs      (no Firebase needed — uses an in-memory fake)
import assert from "node:assert/strict";
import { createHandler } from "../api/_lib/handler.js";
import { hashPassword } from "../src/lib/password.js";

// ---- in-memory Firestore fake
const store = new Map(); // id -> data
const scans = []; // {id, rec}
const fakeDb = {
  collection: () => ({
    doc: (id) => ({
      get: async () => ({ exists: store.has(id), data: () => store.get(id) }),
      update: async (p) => { const d = store.get(id); Object.entries(p).forEach(([k, v]) => { d[k] = v?.__inc ? (d[k] || 0) + v.__inc : v; }); },
      collection: () => ({ add: async (rec) => { scans.push({ id, rec }); } }),
    }),
  }),
};
let T = 1_000_000;
const handler = createHandler({
  getDb: () => fakeDb, secret: () => "test-secret",
  increment: (n) => ({ __inc: n }), serverTs: () => "TS", now: () => T,
});

function call({ id, method = "GET", headers = {}, query = {}, body } = {}) {
  return new Promise(async (resolve) => {
    const res = { statusCode: 200, headers: {}, body: "", setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b || ""; resolve(this); } };
    await handler({ method, headers: { "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Chrome/120", ...headers }, query: { id, ...query }, body }, res);
  });
}
const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/604";
const GEO = { "x-vercel-ip-country": "IN", "x-vercel-ip-city": "New%20Delhi", "x-vercel-ip-country-region": "DL", "accept-language": "en-IN,hi;q=0.8" };
let n = 0; const ok = (m) => console.log(`  ✓ ${m}`, ++n && "");

// 1 basic redirect + logging + geo
store.set("abc1234", { destination: "https://example.com/x", scans: 0, ownerId: "u" });
let r = await call({ id: "abc1234", headers: GEO });
assert.equal(r.statusCode, 302); assert.equal(r.headers.Location, "https://example.com/x");
assert.equal(store.get("abc1234").scans, 1);
assert.equal(scans[0].rec.country, "IN"); assert.equal(scans[0].rec.city, "New Delhi"); assert.equal(scans[0].rec.os, "Android"); assert.equal(scans[0].rec.ev, "scan");
assert.ok(String(r.headers["Set-Cookie"]).includes("qrv=")); ok("redirect + counter + geo + visitor cookie");

// 2 per-OS
store.set("app1234", { destination: "https://site.com", destinations: { ios: "https://apps.apple.com/a", android: "https://play.google.com/b" }, scans: 0 });
r = await call({ id: "app1234", headers: { "user-agent": IOS } }); assert.equal(r.headers.Location, "https://apps.apple.com/a");
r = await call({ id: "app1234" }); assert.equal(r.headers.Location, "https://play.google.com/b");
r = await call({ id: "app1234", headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120" } }); assert.equal(r.headers.Location, "https://site.com"); ok("iOS / Android / fallback routing");

// 3 enforced controls
store.set("exp1234", { destination: "https://e.com", expiresAt: { toMillis: () => T - 1 }, scans: 0 });
r = await call({ id: "exp1234" }); assert.equal(r.statusCode, 410); assert.ok(!r.headers.Location);
store.set("pau1234", { destination: "https://e.com", active: false, scans: 0 });
r = await call({ id: "pau1234" }); assert.equal(r.statusCode, 403);
store.set("lim1234", { destination: "https://e.com", maxScans: 2, scans: 2 });
r = await call({ id: "lim1234" }); assert.equal(r.statusCode, 429);
r = await call({ id: "nope" }); assert.equal(r.statusCode, 404);
r = await call({ id: "zzz9999" }); assert.equal(r.statusCode, 404); ok("expired(410) / paused(403) / limit(429) / unknown(404) enforced");

// 4 password
const pw = await hashPassword("secret99");
store.set("pwd1234", { destination: "https://private.com", password: pw, scans: 0 });
const before = scans.length;
r = await call({ id: "pwd1234" }); assert.equal(r.statusCode, 200); assert.ok(r.body.includes("Password required")); assert.equal(scans.length, before);
r = await call({ id: "pwd1234", method: "POST", body: { password: "wrong" } }); assert.equal(r.statusCode, 401);
r = await call({ id: "pwd1234", method: "POST", body: "password=secret99" }); assert.equal(r.statusCode, 303);
const cookie = String(r.headers["Set-Cookie"]).split(";")[0];
r = await call({ id: "pwd1234", headers: { cookie } }); assert.equal(r.statusCode, 302); assert.equal(r.headers.Location, "https://private.com");
r = await call({ id: "pwd1234", headers: { cookie: cookie.replace(/.$/, "0") } }); assert.equal(r.statusCode, 200); // tampered cookie rejected
T += 4_000_000; r = await call({ id: "pwd1234", headers: { cookie } }); assert.equal(r.statusCode, 200); // cookie expired
ok("password: gate, wrong=401, right=303+cookie, tampered/expired rejected (client hash == server verify)");

// brute force limiter
for (let i = 0; i < 10; i++) r = await call({ id: "pwd1234", method: "POST", body: { password: "x" + i }, headers: { "x-forwarded-for": "9.9.9.9" } });
assert.equal(r.statusCode, 429); ok("brute-force limiter kicks in");

// 5 bio
store.set("bio1234", { kind: "bio", scans: 0, bio: { title: "Sharma <script>", description: "Hi", accent: "#e11d48", links: [{ label: "Menu", url: "https://m.com" }, { label: "Call", url: "tel:+919999999999" }, { label: "Bad", url: "javascript:alert(1)" }] } });
r = await call({ id: "bio1234" }); assert.equal(r.statusCode, 200);
assert.ok(r.body.includes("/q/bio1234?go=0")); assert.ok(r.body.includes('href="tel:+919999999999"')); assert.ok(!r.body.includes("javascript:")); assert.ok(!r.body.includes("<script>")); assert.ok(r.body.includes("Sharma &lt;script&gt;"));
r = await call({ id: "bio1234", query: { go: "0" } }); assert.equal(r.headers.Location, "https://m.com");
assert.equal(scans.at(-1).rec.ev, "click"); assert.equal(scans.at(-1).rec.target, "Menu"); assert.equal(store.get("bio1234").scans, 1);
r = await call({ id: "bio1234", query: { go: "2" } }); assert.equal(r.statusCode, 404);
ok("bio page: escaped, unsafe links dropped, click tracked without inflating scan count");

// 6 bots
const c = scans.length; r = await call({ id: "abc1234", headers: { "user-agent": "facebookexternalhit/1.1" } });
assert.equal(r.statusCode, 302); assert.equal(scans.length, c); ok("bots redirect but are not counted");
// 7 robustness
r = await call({ id: "abc1234", headers: { cookie: "x=%E0%A4%A; qrv=ok" } }); assert.equal(r.statusCode, 302); ok("malformed cookie header doesn't crash");
const c2 = scans.length;
r = await call({ id: "abc1234", headers: { "user-agent": "Mozilla/5.0 (Linux; Android 11; CUBOT P60) Mobile Chrome/120" } });
assert.equal(scans.length, c2 + 1); ok("real phones with 'bot' in the name (Cubot) ARE counted");
r = await call({ id: "abc1234", headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" } });
assert.equal(scans.length, c2 + 1); ok("Googlebot still ignored");
r = await call({ id: "abc1234", method: "DELETE" }); assert.equal(r.statusCode, 405); ok("bad method -> 405");
console.log(`\nAll ${n} checks passed.`);
