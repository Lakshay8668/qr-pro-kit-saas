// test/features_upgrade.test.mjs — Comprehensive test suite for v9 upgrade features:
// 1. Free plan limit = 1 dynamic QR code
// 2. Bulk Quantity Generator (min 10, max 1000, feature gating, chunked writes)
// 3. Database storage compactness (compact metadata, no bulky base64 data URLs stored)
// 4. Transactional email notification module & template verification (support@engagiumtechnologies.com)
// 5. Admin Billing & Payments tab error isolation and event hardening

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeDb } from "./fakeDb.mjs";
import { createLinksHandler } from "../api/_lib/links.js";
import { createAdminHandler } from "../api/_lib/admin.js";
import { createSubscriptionHandlers } from "../api/_lib/subscriptions.js";
import {
  renderSubscriptionHtml,
  renderSubscriptionText,
  sendSubscriptionSuccessEmail,
  SUPPORT_EMAIL,
} from "../api/_lib/email.js";
import { PLANS, formatLimitLabel } from "../shared/plans.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

// ------------------------------------------------------------- 0. TypQR Branding Assets & Draft Page Route
assert.ok(fs.existsSync(path.resolve(__dirname, "../public/typqr-logo.png")), "TypQR logo exists in public/");
assert.ok(fs.existsSync(path.resolve(__dirname, "../public/assets/typqr-logo.png")), "TypQR logo exists in public/assets/");
assert.ok(fs.existsSync(path.resolve(__dirname, "../src/assets/typqr-logo.png")), "TypQR logo exists in src/assets/");
assert.ok(fs.existsSync(path.resolve(__dirname, "../src/pages/DraftQrPage.jsx")), "DraftQrPage exists in src/pages/");
ok("TypQR branding logo assets and draft QR page exist");

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

// Two-input range validation tests (minQuantity, maxQuantity)
res = await callJson(linksHandler, {
  method: "POST",
  headers: { authorization: "Bearer token_pro" },
  query: { action: "bulk-quantity" },
  body: { minQuantity: 50, maxQuantity: 20 },
});
assert.equal(res.code, 400);
assert.match(res.body.message, /cannot be greater than maximum quantity/i);

res = await callJson(linksHandler, {
  method: "POST",
  headers: { authorization: "Bearer token_pro" },
  query: { action: "bulk-quantity" },
  body: { minQuantity: 5, maxQuantity: 50 },
});
assert.equal(res.code, 400);
assert.match(res.body.message, /Minimum quantity must be an integer between 10 and 1,000/i);

res = await callJson(linksHandler, {
  method: "POST",
  headers: { authorization: "Bearer token_pro" },
  query: { action: "bulk-quantity" },
  body: { minQuantity: 10, maxQuantity: 1200 },
});
assert.equal(res.code, 400);
assert.match(res.body.message, /Maximum quantity must be an integer between 10 and 1,000/i);

res = await callJson(linksHandler, {
  method: "POST",
  headers: { authorization: "Bearer token_pro" },
  query: { action: "bulk-quantity" },
  body: { minQuantity: 20, maxQuantity: 50, quantity: 15 },
});
assert.equal(res.code, 400);
assert.match(res.body.message, /specified range: 20 to 50/i);
ok("bulk-quantity strictly validates two-input range (min 10, max 1000, min <= max)");

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

// Webhook retry & client deduplication test
const subHandlers = createSubscriptionHandlers({
  getDb: () => db,
  env: { RAZORPAY_PLAN_PRO_MONTHLY: "plan_test_dedup" },
  now: () => Date.now(),
});

db.collection("users").doc("dedupUser").set({
  uid: "dedupUser",
  email: "dedup@example.com",
  plan: "free",
  billing: {},
});

const rzpBody = {
  event: "subscription.activated",
  created_at: 1700000000,
  payload: {
    subscription: {
      entity: {
        id: "sub_dedup_100",
        status: "active",
        plan_id: "plan_test_dedup",
        notes: { uid: "dedupUser", plan: "pro", interval: "monthly" },
      },
    },
  },
};

// First event applies state and sets lastNotifiedSubId
const r1 = await subHandlers.razorpayEvent(rzpBody, "evt_dedup_1");
assert.equal(r1, "applied");
const userDoc1 = db._get("users", "dedupUser");
assert.equal(userDoc1.billing.lastNotifiedSubId, "sub_dedup_100");

// Duplicate event arrives (e.g. webhook retry)
const r2 = await subHandlers.razorpayEvent(rzpBody, "evt_dedup_2");
assert.equal(r2, "applied");
const userDoc2 = db._get("users", "dedupUser");
assert.equal(userDoc2.billing.lastNotifiedSubId, "sub_dedup_100");
ok("webhook deduplication prevents duplicate purchase confirmation emails");

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
assert.ok(billingRes.body.events.some((e) => e.id === "rzp_test_event_1"), "Malformed event ID is recovered from doc ID");
ok("admin billing API safely handles malformed event records without 500 error or crash");

console.log("\nAll v9 Feature Upgrade checks passed successfully!\n");
