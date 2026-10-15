// test/features_upgrade.test.mjs — Comprehensive test suite for v9 upgrade features:
// 1. Free plan limit = 1 dynamic QR code
// 2. Bulk Quantity Generator (min 10, max 1000, feature gating, chunked writes)
// 3. Database storage compactness (compact metadata, no bulky base64 data URLs stored)
// 4. Transactional email notification module & template verification (support@engagiumtechnologies.com)
// 5. Admin Billing & Payments tab error isolation and event hardening

import assert from "node:assert/strict";
import { makeDb } from "./fakeDb.mjs";
import { createLinksHandler } from "../api/_lib/links.js";
import { createAdminHandler } from "../api/_lib/admin.js";
import {
  renderSubscriptionHtml,
  renderSubscriptionText,
  sendSubscriptionSuccessEmail,
  SUPPORT_EMAIL,
} from "../api/_lib/email.js";
import { PLANS, formatLimitLabel } from "../shared/plans.js";

const ok = (msg) => console.log(`  ✓ ${msg}`);

async function callJson(handler, req) {
  let bodyStr = "";
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(chunk) { if (chunk) bodyStr += chunk; },
  };
  await handler(req, res);
  let parsed = null;
  try { parsed = JSON.parse(bodyStr); } catch {}
  return { code: res.statusCode, body: parsed, raw: bodyStr };
}

console.log("Running v9 Feature Upgrade tests...");

// ------------------------------------------------------------- 1. Free Plan Limit & formatLimitLabel
assert.equal(PLANS.free.limits.dynamicQrs, 1, "Free plan limit must be 1 dynamic QR");
assert.equal(formatLimitLabel("dynamicQrs", 1), "editable (dynamic) QR code");
assert.equal(formatLimitLabel("dynamicQrs", 50), "editable (dynamic) QR codes");
assert.equal(formatLimitLabel("staticQrs", 50), "saved static QR codes");
assert.equal(formatLimitLabel("monthlyScans", 500), "tracked scans per month");
ok("shared/plans.js defines Free dynamic QR limit = 1 and formatLimitLabel handles singular/plural");

// ------------------------------------------------------------- 2. Bulk Quantity Mode & Validation
const db = makeDb({
  users: {
    freeUser: { uid: "freeUser", email: "free@example.com", plan: "free" },
    proUser: { uid: "proUser", email: "pro@example.com", plan: "pro", planStatus: "active" },
    adminUser: { uid: "adminUser", email: "admin@example.com", isAdmin: true },
  },
});

const verify = async (token) => {
  if (token === "token_free") return { uid: "freeUser", email: "free@example.com" };
  if (token === "token_pro") return { uid: "proUser", email: "pro@example.com" };
  if (token === "token_admin") return { uid: "adminUser", email: "admin@example.com" };
  throw new Error("Invalid token");
};

let idCounter = 1000;
const newId = () => `id_${++idCounter}`;
const linksHandler = createLinksHandler({
  getDb: () => db,
  verify,
  serverTs: () => Date.now(),
  now: () => Date.now(),
  newId,
  adminUids: ["adminUser"],
});

// Free user calling bulk-quantity -> 402 feature_locked
let res = await callJson(linksHandler, {
  method: "POST",
  headers: { authorization: "Bearer token_free" },
  query: { action: "bulk-quantity" },
  body: { quantity: 20 },
});
assert.equal(res.code, 402);
assert.equal(res.body.error, "feature_locked");
assert.equal(res.body.feature, "bulk");
ok("bulk-quantity is locked for Free users (HTTP 402 feature_locked)");

// Pro user calling bulk-quantity with invalid quantities (less than 10 or greater than 1000)
res = await callJson(linksHandler, {
  method: "POST",
  headers: { authorization: "Bearer token_pro" },
  query: { action: "bulk-quantity" },
  body: { quantity: 5 },
});
assert.equal(res.code, 400);
assert.match(res.body.message, /between 10 and 1,000/);

res = await callJson(linksHandler, {
  method: "POST",
  headers: { authorization: "Bearer token_pro" },
  query: { action: "bulk-quantity" },
  body: { quantity: 1500 },
});
assert.equal(res.code, 400);
assert.match(res.body.message, /between 10 and 1,000/);
ok("bulk-quantity strictly validates quantity between 10 and 1,000");

// Pro user creates batch of 15 QR codes
res = await callJson(linksHandler, {
  method: "POST",
  headers: { authorization: "Bearer token_pro" },
  query: { action: "bulk-quantity" },
  body: {
    quantity: 15,
    labelPrefix: "Table",
    defaultDestination: "https://restaurant.example.com/draft",
    design: { fg: "#000000", bg: "#ffffff" },
  },
});
assert.equal(res.code, 200);
assert.equal(res.body.ids.length, 15);
assert.equal(res.body.quantity, 15);

// Verify records in database
const firstCreatedId = res.body.ids[0];
const firstDoc = db._get("links", firstCreatedId);
assert.ok(firstDoc);
assert.equal(firstDoc.ownerId, "proUser");
assert.equal(firstDoc.label, "Table #1");
assert.equal(firstDoc.destination, "https://restaurant.example.com/draft");
assert.equal(firstDoc.isDraft, true);
assert.equal(firstDoc.active, true);
ok("bulk-quantity generates assigned draft QR records with unique IDs and placeholder destination");

// ------------------------------------------------------------- 3. Storage Optimization & Compactness
// Ensure no base64 data URLs or images are stored in database
for (const id of res.body.ids) {
  const d = db._get("links", id);
  assert.ok(!d.imageData, "No raw image data in link record");
  assert.ok(!d.pngBase64, "No pngBase64 in link record");
  assert.ok(!String(d.destination || "").startsWith("data:image"), "Destination is not a data URL");
  assert.ok(!String(d.payload || "").startsWith("data:image"), "Payload is not a data URL");
}
ok("database records are compact metadata only (no heavy base64 QR images stored in DB)");

// ------------------------------------------------------------- 4. Transactional Email Module
assert.equal(SUPPORT_EMAIL, "support@engagiumtechnologies.com");

const html = renderSubscriptionHtml({
  customerName: "Alice Smith",
  planName: "Pro",
  interval: "monthly",
  amount: "₹299",
  provider: "Razorpay",
  subscriptionId: "sub_test_123",
});
assert.ok(html.includes("support@engagiumtechnologies.com"), "HTML includes support email");
assert.ok(html.includes("Alice Smith"), "HTML includes customer name");
assert.ok(html.includes("Pro"), "HTML includes plan name");
assert.ok(html.includes("₹299"), "HTML includes amount");
assert.ok(html.includes("sub_test_123"), "HTML includes subscription ID");

const text = renderSubscriptionText({
  customerName: "Alice Smith",
  planName: "Pro",
  interval: "monthly",
  amount: "₹299",
  provider: "Razorpay",
  subscriptionId: "sub_test_123",
});
assert.ok(text.includes("support@engagiumtechnologies.com"), "Text includes support email");
assert.ok(text.includes("Alice Smith"), "Text includes customer name");

// Send simulated email
const emailRes = await sendSubscriptionSuccessEmail({
  toEmail: "alice@example.com",
  customerName: "Alice Smith",
  planName: "Pro",
  interval: "monthly",
  amount: "₹299",
  provider: "Razorpay",
  subscriptionId: "sub_test_123",
});
assert.equal(emailRes.ok, true);

// Invalid recipient handled cleanly without throwing
const badEmailRes = await sendSubscriptionSuccessEmail({ toEmail: "not-an-email" });
assert.equal(badEmailRes.ok, false);
assert.equal(badEmailRes.reason, "invalid_recipient");
ok("transactional email module formats HTML/text with support contact and sends safely");

// ------------------------------------------------------------- 5. Admin Billing & Event Hardening
// Create billing event with null id and missing fields to ensure no server crash
db.collection("billingEvents").doc("rzp_test_event_1").set({
  id: undefined, // intentionally missing
  uid: "proUser",
  plan: "pro",
  ts: null,
});

const adminApi = createAdminHandler({
  getDb: () => db,
  verify,
  adminUids: ["adminUser"],
  serverTs: () => Date.now(),
  now: () => Date.now(),
});

const billingRes = await callJson(adminApi, {
  method: "GET",
  headers: { authorization: "Bearer token_admin" },
  query: { action: "billing" },
});
assert.equal(billingRes.code, 200);
assert.ok(Array.isArray(billingRes.body.events));
assert.ok(billingRes.body.events.length >= 1);
assert.equal(billingRes.body.events[0].id, "rzp_test_event_1");
ok("admin billing API safely handles malformed event records without 500 error or crash");

console.log("\nAll v9 Feature Upgrade checks passed successfully!\n");
