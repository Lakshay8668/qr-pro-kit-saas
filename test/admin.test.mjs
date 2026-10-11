// Run: node test/admin.test.mjs  (in-memory fake, no Firebase needed)
import assert from "node:assert/strict";
import { createAdminHandler } from "../api/_lib/admin.js";

const T = Date.UTC(2026, 9, 10, 12);
const ts = (t) => ({ toMillis: () => t });
const colls = {
  users: new Map([
    ["admin1", { email: "boss@x.com", createdAt: ts(T - 30 * 86400000) }],
    ["u1", { email: "a@x.com", displayName: "Asha", createdAt: ts(T - 2 * 86400000), disabled: false }],
    ["u2", { email: "b@x.com", createdAt: ts(T - 20 * 86400000), disabled: false }],
  ]),
  links: new Map([
    ["L1", { ownerId: "u1", label: "Menu", kind: "redirect", type: "pdf", scans: 40, createdAt: ts(T - 86400000) }],
    ["L2", { ownerId: "u1", label: "Wifi", kind: "static", type: "wifi", scans: 0, createdAt: ts(T - 3600e3) }],
    ["L3", { ownerId: "u2", label: "Shop", kind: "redirect", type: "url", scans: 9, createdAt: ts(T - 5 * 86400000), password: { hash: "x" } }],
    ["L4", { ownerId: "ghost", label: "Old v5", kind: "redirect", type: "url", scans: 1, createdAt: ts(T - 9 * 86400000) }],
  ]),
  scans_L1: new Map([["s1", {}], ["s2", {}]]),
  adminLog: new Map(),
};
const mkRef = (name, id) => ({ id, get: async () => ({ exists: colls[name].has(id), data: () => colls[name].get(id) }),
  update: async (p) => Object.assign(colls[name].get(id), p),
  set: async (p, o) => colls[name].set(id, o?.merge ? { ...(colls[name].get(id) || {}), ...p } : p),
  delete: async () => colls[name].delete(id),
  collection: (sub) => mkQuery(`${sub}_${id}`), _name: name });
function mkQuery(name, filt = () => true, lim = 1e9) {
  const q = {
    limit: (n) => mkQuery(name, filt, n),
    where: (f, op, v) => mkQuery(name, (d) => filt(d) && d[f] === v, lim),
    get: async () => { const docs = [...colls[name].entries()].filter(([, d]) => filt(d)).slice(0, lim).map(([id, d]) => ({ id, data: () => d, ref: mkRef(name, id) })); return { docs, empty: !docs.length }; },
    doc: (id) => mkRef(name, id),
    add: async (d) => colls[name].set("log" + colls[name].size, d),
  };
  return q;
}
const db = { collection: (n) => mkQuery(n), batch: () => { const ops = []; return { update: (r, p) => ops.push(() => r.update(p)), delete: (r) => ops.push(() => r.delete()), commit: async () => ops.forEach((f) => f()) }; } };
const authDisabled = {};
const h = createAdminHandler({
  getDb: () => db, serverTs: () => "TS", now: () => T,
  verify: async (t) => { if (t === "tokAdmin") return { uid: "admin1", email: "boss@x.com" }; if (t === "tokUser") return { uid: "u1", email: "a@x.com" }; throw new Error("bad"); },
  adminUids: () => ["admin1"], setAuthDisabled: async (uid, d) => { authDisabled[uid] = d; },
});
const call = (o) => new Promise(async (resolve) => {
  const res = { statusCode: 200, headers: {}, setHeader() {}, end(b) { resolve({ code: this.statusCode, body: JSON.parse(b) }); } };
  await h({ method: "GET", headers: {}, query: {}, ...o }, res);
});
let n = 0; const ok = (m) => console.log(`  ✓ ${m}`) || n++;
const A = { authorization: "Bearer tokAdmin" };

let r = await call({ query: { action: "overview" } }); assert.equal(r.code, 401); ok("no token -> 401");
r = await call({ headers: { authorization: "Bearer nope" }, query: { action: "overview" } }); assert.equal(r.code, 401);
r = await call({ headers: { authorization: "Bearer tokUser" }, query: { action: "overview" } }); assert.equal(r.code, 403); assert.equal(r.body.uid, "u1"); ok("normal customer -> 403 (and sees own uid for setup)");
r = await call({ headers: { authorization: "Bearer tokUser" }, method: "POST", query: { action: "link-delete" }, body: { id: "L1" } }); assert.equal(r.code, 403); assert.ok(colls.links.has("L1")); ok("customer cannot delete via admin API");

r = await call({ headers: A, query: { action: "overview" } }); assert.equal(r.code, 200);
assert.deepEqual([r.body.users, r.body.qrs, r.body.editable, r.body.static, r.body.scans, r.body.files, r.body.protectedQrs, r.body.newUsers7d], [3, 4, 3, 1, 50, 1, 1, 1]);
assert.equal(r.body.topQrs[0].label, "Menu"); assert.equal(r.body.topQrs[0].owner, "a@x.com"); assert.equal(r.body.signupsByDay.length, 14); ok("overview numbers correct");

r = await call({ headers: A, query: { action: "users" } }); const u1 = r.body.users.find((u) => u.uid === "u1");
assert.deepEqual([u1.qrs, u1.static, u1.scans], [2, 1, 40]); assert.ok(r.body.users.find((u) => u.uid === "ghost")); ok("per-user counts + legacy owner without profile shown");

r = await call({ headers: A, query: { action: "links", q: "asha" } }); assert.equal(r.body.total, 0);
r = await call({ headers: A, query: { action: "links", q: "a@x.com" } }); assert.equal(r.body.total, 2); assert.ok(!JSON.stringify(r.body).includes('"hash"')); ok("link search; no password hashes leak");

r = await call({ headers: A, method: "POST", query: { action: "user-disable" }, body: { uid: "u1", disabled: true } });
assert.equal(r.body.linksChanged, 2); assert.equal(colls.links.get("L1").active, false); assert.equal(colls.links.get("L1").adminPaused, true); assert.equal(authDisabled.u1, true); assert.equal(colls.users.get("u1").disabled, true);
r = await call({ headers: A, method: "POST", query: { action: "user-disable" }, body: { uid: "u1", disabled: false } });
assert.equal(colls.links.get("L1").active, true); assert.equal(authDisabled.u1, false); ok("disable user: login blocked + links paused; enable restores only admin-paused ones");
r = await call({ headers: A, method: "POST", query: { action: "user-disable" }, body: { uid: "admin1", disabled: true } }); assert.equal(r.code, 400); ok("admin can't lock themselves out");

r = await call({ headers: A, method: "POST", query: { action: "link-active" }, body: { id: "L3", active: false } }); assert.equal(colls.links.get("L3").active, false);
r = await call({ headers: A, method: "POST", query: { action: "link-delete" }, body: { id: "L1" } }); assert.ok(!colls.links.has("L1")); assert.equal(colls.scans_L1.size, 0); ok("pause link; delete link also deletes scan history");
assert.ok(colls.adminLog.size >= 4); ok("every admin action is written to adminLog");

// ---- v9: plans
colls.users.set("u2", { ...colls.users.get("u2"), plan: "pro", planStatus: "active", currentPeriodEnd: T + 5 * 86400000, planSource: "stripe" });
r = await call({ headers: A, query: { action: "overview" } }); assert.deepEqual(r.body.plans, { free: 2, pro: 1, business: 0 });
r = await call({ headers: A, query: { action: "users" } }); assert.equal(r.body.users.find((u) => u.uid === "u2").plan, "pro"); assert.equal(r.body.users.find((u) => u.uid === "u1").plan, "free"); ok("overview + customer list show plans");
r = await call({ headers: { authorization: "Bearer tokUser" }, method: "POST", query: { action: "user-plan" }, body: { uid: "u1", plan: "business" } }); assert.equal(r.code, 403); assert.equal(colls.users.get("u1").plan, undefined); ok("customers can't grant themselves a plan");
r = await call({ headers: A, method: "POST", query: { action: "user-plan" }, body: { uid: "u1", plan: "enterprise" } }); assert.equal(r.code, 400);
r = await call({ headers: A, method: "POST", query: { action: "user-plan" }, body: { uid: "u1", plan: "business", days: 30 } }); assert.equal(r.code, 200);
assert.deepEqual([colls.users.get("u1").plan, colls.users.get("u1").planSource, colls.users.get("u1").currentPeriodEnd, colls.users.get("u1").ent.dynamicQrs], ["business", "admin", T + 30 * 86400000, 500]); ok("admin can grant a plan (optionally time-limited) and it writes the entitlements snapshot");
r = await call({ headers: A, method: "POST", query: { action: "user-plan" }, body: { uid: "u1", plan: "free" } }); assert.equal(colls.users.get("u1").ent.plan, "free"); ok("admin can reset a customer to Free");
console.log(`\nAll ${n} admin checks passed.`);
