// Run: node test/billing.test.mjs   (no Firebase, no network — in-memory fakes)
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { effectivePlanId, entitlementsFor, PLANS } from "../shared/plans.js";
import { createLinksHandler } from "../api/_lib/links.js";
import { createBillingHandler } from "../api/_lib/billing.js";
import { createSubscriptionHandlers } from "../api/_lib/subscriptions.js";
import { verifyStripeSignature, verifyRazorpaySignature, formEncode } from "../api/_lib/providers.js";
import { makeDb, callJson } from "./fakeDb.mjs";
import { readRaw } from "../api/_lib/raw.js";
import { EventEmitter } from "node:events";

const DAY = 86400000;
const T = Date.UTC(2026, 9, 11, 12);
let n = 0;
const ok = (m) => console.log(`  ✓ ${m}`) || n++;
const verify = async (t) => { const m = /^tok_(\w+)$/.exec(t); if (!m) throw new Error("bad"); return { uid: m[1], email: `${m[1]}@x.com` }; };
const A = (uid) => ({ authorization: `Bearer tok_${uid}` });
const pwSpec = { salt: "a".repeat(32), hash: "b".repeat(64), iter: 100000 };

// ------------------------------------------------------------------ 1. plan logic
{
  assert.equal(effectivePlanId({}, T), "free");
  assert.equal(effectivePlanId({ plan: "pro", planStatus: "active", currentPeriodEnd: T + DAY }, T), "pro");
  assert.equal(effectivePlanId({ plan: "pro", planStatus: "active", currentPeriodEnd: T - 2 * DAY }, T), "pro"); // renewal slack
  assert.equal(effectivePlanId({ plan: "pro", planStatus: "active", currentPeriodEnd: T - 4 * DAY }, T), "free");
  assert.equal(effectivePlanId({ plan: "pro", planStatus: "canceled", currentPeriodEnd: T + DAY }, T), "pro"); // paid period still running
  assert.equal(effectivePlanId({ plan: "pro", planStatus: "canceled", currentPeriodEnd: T - 1 }, T), "free");
  assert.equal(effectivePlanId({ plan: "business", planStatus: "past_due", currentPeriodEnd: T - 2 * DAY }, T), "business"); // dunning grace
  assert.equal(effectivePlanId({ plan: "business", planStatus: "past_due", currentPeriodEnd: T - 6 * DAY }, T), "free");
  assert.equal(effectivePlanId({ plan: "pro", planStatus: "active", currentPeriodEnd: 0 }, T), "pro"); // admin grant, no expiry
  assert.equal(effectivePlanId({ plan: "hacker" }, T), "free");
  assert.equal(entitlementsFor({ plan: "pro", planStatus: "active" }, T).monthlyScans, PLANS.pro.limits.monthlyScans);
  ok("plan entitlement rules (active / canceled-but-paid / past_due grace / expiry / admin grant)");
}

// ------------------------------------------------------------------ 2. link creation + limits
{
  let c = 0;
  const db = makeDb({ users: { free1: { email: "f@x.com" }, pro1: { plan: "pro", planStatus: "active", currentPeriodEnd: T + DAY }, off1: { disabled: true } } });
  const h = createLinksHandler({ getDb: () => db, verify, serverTs: () => "TS", now: () => T, newId: () => `L${String(++c).padStart(5, "0")}` });
  const create = (uid, link) => callJson(h, { method: "POST", headers: A(uid), query: { action: "create" }, body: { link } });
  const url = (i) => ({ kind: "redirect", destination: `https://e.com/${i}`, label: `q${i}` });

  let r = await callJson(h, { method: "POST", query: { action: "create" }, body: { link: url(0) } });
  assert.equal(r.code, 401);
  r = await callJson(h, { method: "GET", headers: A("free1") }); assert.equal(r.code, 405); ok("auth required, POST only");

  r = await create("free1", url(1)); assert.equal(r.code, 200);
  assert.equal(db._get("links", r.body.id).ownerId, "free1"); assert.equal(db._get("links", r.body.id).scans, 0);
  r = await create("free1", url(2));
  assert.equal(r.code, 402); assert.equal(r.body.error, "limit_reached"); assert.equal(r.body.limit, "dynamicQrs"); assert.equal(r.body.max, 1); assert.equal(r.body.upgrade, true);
  ok("free plan: 1 editable QR code, the 2nd is refused with an upgrade hint");

  r = await create("free1", { kind: "static", payload: "WIFI:T:WPA;S:x;P:y;;", type: "wifi", label: "Wifi" }); assert.equal(r.code, 200);
  ok("static QR codes are counted separately and still allowed at the dynamic limit");

  r = await create("free1", { ...url(9), password: pwSpec }); assert.equal(r.code, 402); // (also over limit) -> use a fresh free user for the pure feature test
  const db2 = makeDb({ users: { f2: {} } });
  const h2 = createLinksHandler({ getDb: () => db2, verify, serverTs: () => "TS", now: () => T });
  const c2 = (link) => callJson(h2, { method: "POST", headers: A("f2"), query: { action: "create" }, body: { link } });
  r = await c2({ ...url(1), password: pwSpec }); assert.equal(r.code, 402); assert.equal(r.body.error, "feature_locked"); assert.equal(r.body.feature, "password");
  r = await c2({ ...url(1), destinations: { ios: "https://apps.apple.com/a" } }); assert.equal(r.body.feature, "deviceTargeting");
  r = await c2({ ...url(1) }); assert.equal(r.code, 200); ok("free plan cannot set password or per-OS redirects");

  r = await create("pro1", { ...url(1), password: pwSpec, destinations: { ios: "https://apps.apple.com/a" }, expiresAt: T + 5 * DAY, maxScans: 100 });
  assert.equal(r.code, 200);
  const doc = db._get("links", r.body.id);
  assert.deepEqual(doc.password, pwSpec); assert.equal(doc.destinations.ios, "https://apps.apple.com/a"); assert.equal(doc.maxScans, 100); assert.ok(doc.expiresAt instanceof Date); ok("pro plan: password + per-OS + expiry + scan cap accepted");

  r = await create("pro1", { ...url(1), password: { salt: "zz", hash: "yy", iter: 1 } }); assert.equal(r.code, 400);
  r = await create("pro1", { kind: "redirect", destination: "javascript:alert(1)" }); assert.equal(r.code, 400);
  r = await create("pro1", { kind: "weird" }); assert.equal(r.code, 400);
  r = await create("pro1", { kind: "bio", bio: { title: "x", links: [] } }); assert.equal(r.code, 400);
  r = await create("pro1", { kind: "static", payload: "  " }); assert.equal(r.code, 400); ok("bad passwords / URLs / kinds / empty bio / empty static are rejected");

  r = await create("pro1", { ...url(1), ownerId: "someoneElse", scans: 999 }); assert.equal(db._get("links", r.body.id).ownerId, "pro1"); assert.equal(db._get("links", r.body.id).scans, 0);
  ok("owner and scan counter are always set by the server");

  r = await create("off1", url(1)); assert.equal(r.code, 403); assert.equal(r.body.error, "account_disabled"); ok("disabled accounts can't create");

  // bulk
  const many = (k) => Array.from({ length: k }, (_, i) => ({ kind: "redirect", destination: `https://e.com/b${i}`, label: `b${i}` }));
  const bulk = (uid, items) => callJson(h, { method: "POST", headers: A(uid), query: { action: "create-many" }, body: { items } });
  r = await bulk("free1", many(2)); assert.equal(r.code, 402); assert.equal(r.body.feature, "bulk");
  r = await bulk("pro1", many(10)); assert.equal(r.code, 200); assert.equal(r.body.ids.length, 10); assert.equal(new Set(r.body.ids).size, 10);
  r = await bulk("pro1", many(45)); assert.equal(r.code, 402); assert.equal(r.body.limit, "dynamicQrs"); assert.match(r.body.message, /only 38 are left/);
  assert.equal(db._all("links").filter((l) => l.ownerId === "pro1").length, 12, "all-or-nothing: nothing written by the refused batch");
  r = await bulk("pro1", many(201)); assert.equal(r.code, 400);
  r = await bulk("pro1", [{ kind: "bio" }]); assert.equal(r.code, 400); ok("bulk: gated by plan, capped by remaining quota, all-or-nothing, max 200 rows");

  // id collision retry
  let k = 0;
  const db3 = makeDb({ users: { p: { plan: "pro", planStatus: "active", currentPeriodEnd: 0 } }, links: { SAMEID1: { ownerId: "other", kind: "redirect" } } });
  const h3 = createLinksHandler({ getDb: () => db3, verify, serverTs: () => "TS", now: () => T, newId: () => (k++ < 2 ? "SAMEID1" : `OK${k}xxxx`) });
  r = await callJson(h3, { method: "POST", headers: A("p"), query: { action: "create" }, body: { link: url(1) } });
  assert.equal(r.code, 200); assert.ok(r.body.id.startsWith("OK")); assert.equal(db3._get("links", "SAMEID1").ownerId, "other"); ok("short-id collision retries and never overwrites someone else's QR");
}

// ------------------------------------------------------------------ 3. webhooks
const env = {
  STRIPE_PRICE_PRO_MONTHLY: "price_pro_m", STRIPE_PRICE_PRO_YEARLY: "price_pro_y", STRIPE_PRICE_BUSINESS_MONTHLY: "price_biz_m",
  RAZORPAY_PLAN_PRO_MONTHLY: "plan_pro_m", RAZORPAY_PLAN_BUSINESS_YEARLY: "plan_biz_y",
};
{
  const raw = JSON.stringify({ hello: "world" });
  const secret = "whsec_test";
  const sig = (t, body = raw, s = secret) => `t=${t},v1=${crypto.createHmac("sha256", s).update(`${t}.${body}`).digest("hex")}`;
  const t = Math.floor(T / 1000);
  assert.ok(verifyStripeSignature(raw, sig(t), secret, T));
  assert.ok(!verifyStripeSignature(raw, sig(t), "other", T));
  assert.ok(!verifyStripeSignature(raw + " ", sig(t), secret, T));
  assert.ok(!verifyStripeSignature(raw, sig(t - 1000), secret, T), "replay outside the 5-minute window");
  assert.ok(!verifyStripeSignature(raw, "", secret, T) && !verifyStripeSignature(raw, sig(t), "", T));
  const rz = crypto.createHmac("sha256", "rzsecret").update(raw).digest("hex");
  assert.ok(verifyRazorpaySignature(raw, rz, "rzsecret")); assert.ok(!verifyRazorpaySignature(raw, rz, "nope")); assert.ok(!verifyRazorpaySignature(raw, "00", "rzsecret"));
  assert.equal(formEncode({ mode: "subscription", line_items: [{ price: "p", quantity: 1 }], metadata: { uid: "u 1" } }), "mode=subscription&line_items%5B0%5D%5Bprice%5D=p&line_items%5B0%5D%5Bquantity%5D=1&metadata%5Buid%5D=u%201");
  ok("webhook signatures (Stripe HMAC + replay window, Razorpay HMAC) and Stripe form encoding");
}

{
  const db = makeDb({ users: { u1: { email: "a@x.com" }, u2: { email: "b@x.com" } } });
  let live = null;
  const stripeSub = (o = {}) => ({ id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: false, current_period_end: Math.floor((T + 30 * DAY) / 1000), items: { data: [{ price: { id: "price_pro_m" } }] }, metadata: { uid: "u1", plan: "pro", interval: "monthly" }, ...o });
  const h = createSubscriptionHandlers({ getDb: () => db, env, now: () => T, serverTs: () => "TS", stripe: () => ({ getSubscription: async () => live }) });
  const ev = (id, type, object, created = Math.floor(T / 1000)) => ({ id, type, created, data: { object } });

  live = stripeSub();
  let r = await h.stripeEvent(ev("evt_1", "checkout.session.completed", { mode: "subscription", subscription: "sub_1", client_reference_id: "u1", metadata: { uid: "u1", plan: "pro", interval: "monthly" } }));
  assert.equal(r, "applied");
  let u = db._get("users", "u1");
  assert.equal(u.plan, "pro"); assert.equal(u.planStatus, "active"); assert.equal(u.planInterval, "monthly"); assert.equal(u.billing.customerId, "cus_1"); assert.equal(u.billing.subscriptionId, "sub_1");
  assert.equal(u.currentPeriodEnd, T + 30 * DAY); assert.equal(u.ent.dynamicQrs, 50); assert.equal(u.ent.password, true); assert.equal(u.email, "a@x.com", "merge keeps existing fields");
  ok("stripe checkout.session.completed -> plan active, ent snapshot written, existing user fields kept");

  assert.equal(await h.stripeEvent(ev("evt_1", "checkout.session.completed", { mode: "subscription", subscription: "sub_1", client_reference_id: "u1" })), "duplicate"); ok("retried webhook is a no-op (idempotent)");

  r = await h.stripeEvent(ev("evt_2", "customer.subscription.updated", stripeSub({ cancel_at_period_end: true }), Math.floor(T / 1000) + 10));
  assert.equal(db._get("users", "u1").cancelAtPeriodEnd, true); assert.equal(db._get("users", "u1").plan, "pro"); ok("cancel-at-period-end keeps access until the period ends");

  r = await h.stripeEvent(ev("evt_old", "customer.subscription.updated", stripeSub({ status: "past_due" }), Math.floor(T / 1000) - 500));
  assert.equal(r, "stale"); assert.equal(db._get("users", "u1").planStatus, "active"); ok("out-of-order (older) event is ignored");

  r = await h.stripeEvent(ev("evt_3", "customer.subscription.updated", stripeSub({ items: { data: [{ price: { id: "price_biz_m" } }] }, metadata: {} }), Math.floor(T / 1000) + 20));
  assert.equal(db._get("users", "u1").plan, "business"); assert.equal(db._get("users", "u1").ent.dynamicQrs, 500); ok("plan change detected from the Stripe price id (no trust in client data)");

  r = await h.stripeEvent(ev("evt_4", "customer.subscription.deleted", stripeSub({ id: "sub_OLD", status: "canceled", metadata: { uid: "u1" } }), Math.floor(T / 1000) + 30));
  assert.equal(r, "other_subscription"); assert.equal(db._get("users", "u1").plan, "business"); ok("late 'deleted' for an OLD subscription can't wipe the current one");

  r = await h.stripeEvent(ev("evt_5", "customer.subscription.deleted", stripeSub({ status: "canceled", metadata: {}, items: { data: [{ price: { id: "price_biz_m" } }] } }), Math.floor(T / 1000) + 40));
  u = db._get("users", "u1"); assert.equal(r, "applied"); assert.equal(u.planStatus, "canceled"); // uid found through billing.customerId
  assert.equal(effectivePlanId(u, T), "business"); assert.equal(effectivePlanId(u, T + 31 * DAY), "free"); assert.equal(u.ent.plan, "business"); ok("subscription.deleted (uid via customer id) -> canceled; access ends when the paid period does");

  assert.equal(await h.stripeEvent(ev("evt_6", "invoice.paid", {})), "ignored");
  assert.equal(await h.stripeEvent(ev("evt_7", "customer.subscription.created", stripeSub({ status: "incomplete" }))), "ignored");
  assert.equal(await h.stripeEvent(ev("evt_8", "customer.subscription.created", stripeSub({ metadata: {}, customer: "cus_nobody" }))), "no_user");
  assert.equal(await h.stripeEvent(ev("evt_9", "customer.subscription.created", stripeSub({ items: { data: [{ price: { id: "price_unknown" } }] }, metadata: { uid: "u2" } }))), "ignored");
  assert.equal(db._get("users", "u2").plan, undefined); ok("unrelated / incomplete / unknown-user / unknown-price events change nothing");

  // razorpay
  const rzSub = (o = {}) => ({ id: "sub_rz1", plan_id: "plan_pro_m", status: "active", customer_id: "cust_1", current_end: Math.floor((T + 30 * DAY) / 1000), has_scheduled_changes: false, notes: { uid: "u2", plan: "pro", interval: "monthly" }, ...o });
  const rz = (event, sub, created_at = Math.floor(T / 1000)) => ({ event, created_at, payload: { subscription: { entity: sub } } });
  assert.equal(await h.razorpayEvent(rz("subscription.authenticated", rzSub({ status: "authenticated", current_end: null })), "e1"), "ignored");
  assert.equal(db._get("users", "u2").plan, undefined);
  assert.equal(await h.razorpayEvent(rz("subscription.activated", rzSub()), "e2"), "applied");
  u = db._get("users", "u2"); assert.equal(u.plan, "pro"); assert.equal(u.billing.provider, "razorpay"); assert.equal(u.currentPeriodEnd, T + 30 * DAY); assert.equal(u.ent.bulk, true);
  assert.equal(await h.razorpayEvent(rz("subscription.activated", rzSub()), "e2"), "duplicate");
  await h.razorpayEvent(rz("subscription.pending", rzSub({ status: "pending" }), Math.floor(T / 1000) + 5), "e3");
  assert.equal(db._get("users", "u2").planStatus, "past_due");
  await h.razorpayEvent(rz("subscription.charged", rzSub({ current_end: Math.floor((T + 60 * DAY) / 1000) }), Math.floor(T / 1000) + 9), "e4");
  u = db._get("users", "u2"); assert.equal(u.planStatus, "active"); assert.equal(u.currentPeriodEnd, T + 60 * DAY);
  await h.razorpayEvent(rz("subscription.halted", rzSub({ status: "halted" }), Math.floor(T / 1000) + 20), "e5");
  assert.equal(db._get("users", "u2").planStatus, "canceled");
  // Test fallback uid lookup via billing.subscriptionId when notes.uid is missing, and charge_at fallback
  const rzNoNotes = rzSub({ status: "active", current_end: null, charge_at: Math.floor((T + 90 * DAY) / 1000), notes: { plan: "pro" } });
  assert.equal(await h.razorpayEvent(rz("subscription.charged", rzNoNotes, Math.floor(T / 1000) + 25), "e6"), "applied");
  assert.equal(db._get("users", "u2").planStatus, "active");
  assert.equal(db._get("users", "u2").currentPeriodEnd, T + 90 * DAY);
  ok("razorpay: authenticated ignored -> activated -> pending(past_due) -> charged(renewed) -> halted(canceled) -> no-notes fallback -> duplicates ignored");
  assert.equal(h.eventIdFor("body", "hdr"), "hdr"); assert.equal(h.eventIdFor("body", undefined).length, 40);
}

// ------------------------------------------------------------------ 4. billing API
{
  const db = makeDb({
    users: {
      free1: { email: "f@x.com" },
      pro1: { plan: "pro", planStatus: "active", currentPeriodEnd: T + 20 * DAY, planInterval: "monthly", billing: { provider: "stripe", customerId: "cus_9", subscriptionId: "sub_9" }, planSource: "stripe" },
      rz1: { plan: "pro", planStatus: "active", currentPeriodEnd: T + 20 * DAY, billing: { provider: "razorpay", customerId: "c", subscriptionId: "sub_rz" }, planSource: "razorpay" },
      grant: { plan: "business", planStatus: "active", currentPeriodEnd: 0, planSource: "admin" },
    },
    links: { a: { ownerId: "pro1", kind: "redirect" }, b: { ownerId: "pro1", kind: "redirect" }, c: { ownerId: "pro1", kind: "static" } },
    usage: { "pro1_202610": { scans: 123 } },
  });
  const calls = [];
  const fakeStripe = { createCheckout: async (p) => { calls.push(["stripe.checkout", p]); return { url: "https://checkout.stripe.test/s1" }; }, createPortal: async (p) => { calls.push(["stripe.portal", p]); return { url: "https://billing.stripe.test/p" }; }, setCancelAtPeriodEnd: async (id, v) => calls.push(["stripe.cancel", id, v]) };
  const fakeRz = { createSubscription: async (p) => { calls.push(["rz.sub", p]); return { short_url: "https://rzp.io/i/abc" }; }, cancelAtCycleEnd: async (id) => calls.push(["rz.cancel", id]) };
  const E = { ...env, STRIPE_SECRET_KEY: "sk", RAZORPAY_KEY_ID: "k", RAZORPAY_KEY_SECRET: "s", APP_URL: "https://qr.example.in/" };
  const h = createBillingHandler({ getDb: () => db, verify, env: () => E, makeStripe: () => fakeStripe, makeRazorpay: () => fakeRz, now: () => T, serverTs: () => "TS" });
  const get = (uid, action) => callJson(h, { headers: A(uid), query: { action } });
  const post = (uid, action, body) => callJson(h, { method: "POST", headers: A(uid), query: { action }, body });

  let r = await callJson(h, { query: { action: "config" } }); assert.deepEqual(r.body.providers, { stripe: true, razorpay: true });
  const hNone = createBillingHandler({ getDb: () => db, verify, env: () => ({}), makeStripe: () => fakeStripe, makeRazorpay: () => fakeRz, now: () => T });
  r = await callJson(hNone, { query: { action: "config" } }); assert.deepEqual(r.body.providers, { stripe: false, razorpay: false });
  r = await callJson(h, { query: { action: "me" } }); assert.equal(r.code, 401); ok("config is public, me needs sign-in, providers reflect env");

  r = await get("pro1", "me");
  assert.equal(r.body.plan, "pro"); assert.deepEqual(r.body.usage, { dynamicQrs: 2, staticQrs: 1, monthlyScans: 123, month: "202610" });
  assert.equal(r.body.limits.monthlyScans, 20000); assert.equal(r.body.canManage, true); assert.equal(r.body.canCancel, true); assert.equal(r.body.features.bulk, true);
  r = await get("free1", "me"); assert.equal(r.body.plan, "free"); assert.equal(r.body.limits.dynamicQrs, 1); assert.equal(r.body.canCancel, false);
  r = await get("grant", "me"); assert.equal(r.body.plan, "business"); assert.equal(r.body.canCancel, false); ok("me: plan, limits, live usage, manage/cancel flags (admin grants can't be 'cancelled')");

  r = await post("free1", "checkout", { plan: "pro", interval: "monthly", provider: "stripe" });
  assert.equal(r.body.url, "https://checkout.stripe.test/s1");
  const sc = calls.at(-1)[1]; assert.equal(sc.priceId, "price_pro_m"); assert.equal(sc.uid, "free1"); assert.equal(sc.successUrl, "https://qr.example.in/billing?checkout=success"); assert.equal(sc.cancelUrl, "https://qr.example.in/pricing?checkout=cancel");
  r = await post("free1", "checkout", { plan: "pro", interval: "monthly", provider: "razorpay" });
  assert.equal(r.body.url, "https://rzp.io/i/abc"); assert.deepEqual(calls.at(-1)[1], { planId: "plan_pro_m", uid: "free1", plan: "pro", interval: "monthly" });
  ok("checkout: server picks the provider price/plan id from env + signs uid into metadata (client can't choose a price)");

  r = await post("free1", "checkout", { plan: "free", interval: "monthly", provider: "stripe" }); assert.equal(r.code, 400);
  r = await post("free1", "checkout", { plan: "pro", interval: "weekly", provider: "stripe" }); assert.equal(r.code, 400);
  r = await post("free1", "checkout", { plan: "pro", interval: "monthly", provider: "paypal" }); assert.equal(r.code, 400);
  r = await post("free1", "checkout", { plan: "business", interval: "yearly", provider: "stripe" }); assert.equal(r.code, 503); assert.equal(r.body.error, "not_configured");
  r = await post("pro1", "checkout", { plan: "business", interval: "monthly", provider: "stripe" }); assert.equal(r.code, 409); assert.equal(r.body.portal, true);
  r = await post("rz1", "checkout", { plan: "pro", interval: "monthly", provider: "razorpay" }); assert.equal(r.code, 409); assert.equal(r.body.portal, false);
  r = await post("grant", "checkout", { plan: "pro", interval: "monthly", provider: "stripe" }); assert.equal(r.code, 200); ok("checkout guards: free/unknown plan, bad interval/provider, missing price id, double subscription");

  r = await post("pro1", "portal"); assert.equal(r.body.url, "https://billing.stripe.test/p"); assert.equal(calls.at(-1)[1].customerId, "cus_9"); assert.equal(calls.at(-1)[1].returnUrl, "https://qr.example.in/billing");
  r = await post("free1", "portal"); assert.equal(r.code, 400); r = await post("rz1", "portal"); assert.equal(r.code, 400); ok("stripe portal only for stripe customers");

  r = await post("pro1", "cancel"); assert.equal(r.body.ok, true); assert.deepEqual(calls.at(-1), ["stripe.cancel", "sub_9", true]); assert.equal(db._get("users", "pro1").cancelAtPeriodEnd, true);
  r = await post("rz1", "cancel"); assert.equal(r.body.ok, true); assert.deepEqual(calls.at(-1), ["rz.cancel", "sub_rz"]);
  r = await post("free1", "cancel"); assert.equal(r.code, 400); r = await post("grant", "cancel"); assert.equal(r.code, 400);
  r = await get("pro1", "me"); assert.equal(r.body.cancelAtPeriodEnd, true); assert.equal(r.body.canCancel, false); assert.equal(r.body.plan, "pro"); ok("cancel at period end (both providers); stays on the plan until the period ends");
  r = await callJson(h, { method: "DELETE", headers: A("pro1"), query: { action: "me" } }); assert.equal(r.code, 405);
}

// ------------------------------------------------------------------ 5. raw body reader (webhooks)
{
  const stream = new EventEmitter();
  const p = readRaw(stream);
  stream.emit("data", Buffer.from('{"a":'));
  stream.emit("data", Buffer.from('"é"}'));
  stream.emit("end");
  assert.equal(await p, '{"a":"é"}');
  assert.equal(await readRaw({ body: "already text" }), "already text");
  await assert.rejects(() => readRaw({ body: { parsed: true } }), /already consumed/);
  await assert.rejects(() => readRaw({ readableEnded: true }), /already consumed/);
  ok("raw webhook body is read byte-exact; a pre-parsed body fails loudly instead of hanging");
}

console.log(`\n${n} billing checks passed`);
