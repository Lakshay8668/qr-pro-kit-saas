// test/production.test.mjs — Comprehensive production repair verification tests
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createUniversalDb, getDb } from "../api/_lib/db.js";
import { createLinksHandler } from "../api/_lib/links.js";
import { verifyToken } from "../api/_lib/auth.js";
import { createHandler as createRedirectHandler } from "../api/_lib/handler.js";
import { createBillingHandler } from "../api/_lib/billing.js";
import { callJson } from "./fakeDb.mjs";

const ok = (m) => console.log(`  ✓ ${m}`);

console.log("Running production repair & verification tests...");

// ------------------------------------------------------------------ 1. Persistent DB & Restart Survival
{
  const testDir = path.resolve("./data/test_db_" + Date.now());
  process.env.DATA_DIR = testDir;

  const db1 = createUniversalDb();
  await db1.collection("links").doc("test_qr_1").set({
    label: "My Coffee Menu",
    destination: "https://cafe.example.com/menu.pdf",
    ownerId: "user_alice",
    kind: "redirect",
    scans: 42,
  });

  const snap1 = await db1.collection("links").doc("test_qr_1").get();
  assert.equal(snap1.exists, true);
  assert.equal(snap1.data().label, "My Coffee Menu");
  ok("universal DB writes and retrieves documents");

  // Verify file was written to disk
  const diskFile = path.join(testDir, "qrpro_db.json");
  assert.equal(fs.existsSync(diskFile), true);
  const rawDisk = JSON.parse(fs.readFileSync(diskFile, "utf8"));
  assert.equal(rawDisk.links.test_qr_1.destination, "https://cafe.example.com/menu.pdf");
  ok("documents are persistently written to disk storage");

  // Simulate server restart: create brand-new database instance
  const db2 = createUniversalDb();
  const snap2 = await db2.collection("links").doc("test_qr_1").get();
  assert.equal(snap2.exists, true);
  assert.equal(snap2.data().destination, "https://cafe.example.com/menu.pdf");
  assert.equal(snap2.data().scans, 42);
  ok("server restart simulation: documents survive restart and reload from persistent store");

  // Cleanup test dir
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
}

// ------------------------------------------------------------------ 2. Links API Lifecycle & Cross-User Security
{
  const db = createUniversalDb();
  let nextId = 100;
  const mockVerify = async (token) => {
    if (token === "token_alice") return { uid: "user_alice_api", email: "alice@example.com" };
    if (token === "token_bob") return { uid: "user_bob_api", email: "bob@example.com" };
    throw new Error("Invalid token");
  };

  const handler = createLinksHandler({
    getDb: () => db,
    verify: mockVerify,
    serverTs: () => new Date(),
    now: () => Date.now(),
    newId: () => `qr_${++nextId}`,
  });

  const authAlice = { Authorization: "Bearer token_alice" };
  const authBob = { Authorization: "Bearer token_bob" };

  // A. Create Dynamic QR (Alice)
  let res = await callJson(handler, {
    method: "POST",
    headers: authAlice,
    query: { action: "create" },
    body: {
      link: {
        destination: "https://alice.example.com/promo",
        label: "Summer Promo",
        kind: "redirect",
      },
    },
  });
  assert.equal(res.code, 200);
  const aliceDynamicId = res.body.id;
  assert.ok(aliceDynamicId);
  ok("POST ?action=create saves dynamic QR code to persistent DB");

  // B. Create Static QR (Alice)
  res = await callJson(handler, {
    method: "POST",
    headers: authAlice,
    query: { action: "create" },
    body: {
      link: {
        payload: "https://alice.example.com/static-flyer",
        label: "Flyer Direct",
        kind: "static",
      },
    },
  });
  assert.equal(res.code, 200);
  const aliceStaticId = res.body.id;
  ok("POST ?action=create saves static QR code for dashboard management");

  // C. List Links (Alice) — must include both dynamic and static QRs
  res = await callJson(handler, {
    method: "GET",
    headers: authAlice,
    query: { action: "list" },
  });
  assert.equal(res.code, 200);
  assert.equal(res.body.links.length, 2);
  const ids = res.body.links.map((l) => l.id);
  assert.ok(ids.includes(aliceDynamicId));
  assert.ok(ids.includes(aliceStaticId));
  ok("GET ?action=list returns all owned QR codes for dashboard");

  // D. Cross-User Security: Bob cannot see Alice's links
  res = await callJson(handler, {
    method: "GET",
    headers: authBob,
    query: { action: "list" },
  });
  assert.equal(res.code, 200);
  assert.equal(res.body.links.length, 0);
  ok("cross-user isolation: user cannot list another user's links");

  // E. Cross-User Security: Bob cannot fetch Alice's link
  res = await callJson(handler, {
    method: "GET",
    headers: authBob,
    query: { action: "get", id: aliceDynamicId },
  });
  assert.equal(res.code, 403);
  assert.equal(res.body.error, "forbidden");
  ok("cross-user isolation: user cannot read another user's link by ID");

  // F. Cross-User Security: Bob cannot update Alice's link
  res = await callJson(handler, {
    method: "POST",
    headers: authBob,
    query: { action: "update" },
    body: {
      id: aliceDynamicId,
      patch: { destination: "https://hacked.com" },
    },
  });
  assert.equal(res.code, 403);
  ok("cross-user isolation: user cannot update another user's link");

  // G. Cross-User Security: Bob cannot delete Alice's link
  res = await callJson(handler, {
    method: "POST",
    headers: authBob,
    query: { action: "delete" },
    body: { id: aliceDynamicId },
  });
  assert.equal(res.code, 403);
  ok("cross-user isolation: user cannot delete another user's link");

  // H. Update destination (Alice)
  res = await callJson(handler, {
    method: "POST",
    headers: authAlice,
    query: { action: "update" },
    body: {
      id: aliceDynamicId,
      patch: {
        destination: "https://alice.example.com/updated-autumn",
        label: "Autumn Promo",
      },
    },
  });
  assert.equal(res.code, 200);
  assert.equal(res.body.ok, true);

  // Verify update was saved
  const updatedSnap = await db.collection("links").doc(aliceDynamicId).get();
  assert.equal(updatedSnap.data().destination, "https://alice.example.com/updated-autumn");
  assert.equal(updatedSnap.data().label, "Autumn Promo");
  ok("POST ?action=update modifies destination without changing permanent short ID");

  // I. Delete Link (Alice)
  res = await callJson(handler, {
    method: "POST",
    headers: authAlice,
    query: { action: "delete" },
    body: { id: aliceStaticId },
  });
  assert.equal(res.code, 200);

  const deletedSnap = await db.collection("links").doc(aliceStaticId).get();
  assert.equal(deletedSnap.exists, false);
  ok("POST ?action=delete permanently removes link from persistent DB");
}

// ------------------------------------------------------------------ 3. Dynamic QR Redirect & Scan Analytics
{
  const db = createUniversalDb();
  await db.collection("links").doc("dyn_qr_abc").set({
    destination: "https://target-domain.com/landing",
    ownerId: "owner_xyz",
    kind: "redirect",
    active: true,
    scans: 0,
  });

  const redirectHandler = createRedirectHandler({
    getDb: () => db,
    secret: () => "test_secret_123",
    increment: (n) => ({ __inc: n }),
    serverTs: () => new Date(),
    quota: {
      check: async () => ({ ok: true, used: 0, limit: 1000, plan: "free" }),
      record: async () => {},
    },
  });

  // Execute scan request
  let locationHeader = "";
  let statusCode = 0;
  const mockReq = {
    method: "GET",
    query: { id: "dyn_qr_abc" },
    headers: {
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
      "x-forwarded-for": "103.21.244.2",
    },
  };
  const mockRes = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
      if (k.toLowerCase() === "location") locationHeader = v;
    },
    end() {},
  };

  await redirectHandler(mockReq, mockRes);
  assert.equal(mockRes.statusCode, 302);
  assert.equal(locationHeader, "https://target-domain.com/landing");
  ok("dynamic QR redirect: /q/:id resolves from DB and returns 302 to destination");

  // Verify scan counter incremented in DB
  const snap = await db.collection("links").doc("dyn_qr_abc").get();
  assert.equal(snap.data().scans, 1);
  ok("scan counter incremented in persistent storage");

  // Verify scan event logged in scans subcollection
  const scansSnap = await db.collection("links").doc("dyn_qr_abc").collection("scans").get();
  assert.equal(scansSnap.docs.length, 1);
  assert.equal(scansSnap.docs[0].data().os, "iOS");
  ok("scan analytics event logged with device/OS/ts in scans collection");
}

// ------------------------------------------------------------------ 4. Resilient Token Verification
{
  // Test mock / valid decoded token
  const res = await verifyToken("mock_alice_uid_123");
  assert.equal(res.uid, "alice_uid_123");
  assert.equal(res.email, "alice_uid_123@example.com");
  ok("verifyToken validates mock/test tokens");

  // Test expired token rejection
  const expiredPayload = {
    sub: "expired_user",
    exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour in the past
    iat: Math.floor(Date.now() / 1000) - 7200,
  };
  const expiredJwt = `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(expiredPayload)).toString("base64url")}.fake_signature`;
  await assert.rejects(
    async () => {
      await verifyToken(expiredJwt);
    },
    /expired/i
  );
  ok("verifyToken correctly rejects expired JWTs");

  // Test malformed token rejection
  await assert.rejects(
    async () => {
      await verifyToken("not.a.jwt.token");
    },
    /malformed|encoding/i
  );
  ok("verifyToken rejects malformed tokens");
}

// ------------------------------------------------------------------ 5. Razorpay Configuration & Checkout Safeguards
{
  const db = createUniversalDb();
  await db.collection("users").doc("user_test").set({
    email: "test@example.com",
    plan: "free",
  });

  // Setup handler with NO Razorpay keys configured
  const emptyEnvHandler = createBillingHandler({
    getDb: () => db,
    verify: async () => ({ uid: "user_test", email: "test@example.com" }),
    env: () => ({}),
    makeStripe: () => ({}),
    makeRazorpay: () => ({}),
    serverTs: () => new Date(),
  });

  // Config endpoint reports providers disabled
  let r = await callJson(emptyEnvHandler, {
    method: "GET",
    query: { action: "config" },
  });
  assert.equal(r.code, 200);
  assert.equal(r.body.providers.razorpay, false);
  ok("GET ?action=config accurately reports payment provider status when env vars are unset");

  // Attempt checkout without gateway keys -> clean 400 provider_unavailable
  r = await callJson(emptyEnvHandler, {
    method: "POST",
    headers: { Authorization: "Bearer test_token" },
    query: { action: "checkout" },
    body: { plan: "pro", interval: "monthly", provider: "razorpay" },
  });
  assert.equal(r.code, 400);
  assert.equal(r.body.error, "provider_unavailable");
  ok("checkout refuses unconfigured payment gateway with clean error instead of crash");

  // Setup handler with Razorpay keys configured
  let createdSubscription = null;
  const configuredHandler = createBillingHandler({
    getDb: () => db,
    verify: async () => ({ uid: "user_test", email: "test@example.com" }),
    env: () => ({
      RAZORPAY_KEY_ID: "rzp_test_mockKey123",
      RAZORPAY_KEY_SECRET: "rzp_secret_mockSecret123",
      RAZORPAY_PLAN_PRO_MONTHLY: "plan_mockProMonthly_123",
    }),
    makeStripe: () => ({}),
    makeRazorpay: () => ({
      createSubscription: async (args) => {
        createdSubscription = args;
        return { id: "sub_mock_123", short_url: "https://rzp.io/i/mockCheckoutUrl" };
      },
    }),
    serverTs: () => new Date(),
  });

  // Attempt checkout with configured plan -> succeeds and returns hosted url
  r = await callJson(configuredHandler, {
    method: "POST",
    headers: { Authorization: "Bearer test_token" },
    query: { action: "checkout" },
    body: { plan: "pro", interval: "monthly", provider: "razorpay" },
  });
  assert.equal(r.code, 200);
  assert.equal(r.body.url, "https://rzp.io/i/mockCheckoutUrl");
  assert.equal(createdSubscription.planId, "plan_mockProMonthly_123");
  assert.equal(createdSubscription.uid, "user_test");
  ok("checkout generates valid subscription and returns Razorpay hosted checkout URL");
}

// ------------------------------------------------------------------ 4. Customer Persistence & Admin Overview Accuracy
{
  const db = createUniversalDb();
  let nextId = 200;

  const mockVerify = async (token) => {
    if (token === "token_charlie") return { uid: "user_charlie", email: "charlie@example.com", name: "Charlie" };
    throw new Error("Invalid token");
  };

  const linksHandler = createLinksHandler({
    getDb: () => db,
    verify: mockVerify,
    serverTs: () => new Date(),
    now: () => Date.now(),
    newId: () => `qr_${++nextId}`,
  });

  // Verify Charlie does not exist in users collection yet
  let userSnap = await db.collection("users").doc("user_charlie").get();
  assert.equal(userSnap.exists, false);

  // Charlie creates a QR code
  const res = await callJson(linksHandler, {
    method: "POST",
    headers: { Authorization: "Bearer token_charlie" },
    query: { action: "create" },
    body: {
      link: {
        destination: "https://charlie.example.com",
        label: "Charlie Shop",
        kind: "redirect",
      },
    },
  });
  assert.equal(res.code, 200);

  // Verify Charlie was automatically persisted to users collection
  userSnap = await db.collection("users").doc("user_charlie").get();
  assert.equal(userSnap.exists, true);
  assert.equal(userSnap.data().email, "charlie@example.com");
  assert.equal(userSnap.data().plan, "free");
  assert.equal(userSnap.data().planStatus, "active");
  ok("customer record is automatically created and persisted when creating QR code");

  // Verify link ownership matches Charlie's UID
  const linkSnap = await db.collection("links").doc(res.body.id).get();
  assert.equal(linkSnap.data().ownerId, "user_charlie");
  ok("link ownership accurately references persistent customer UID");
}

// ------------------------------------------------------------------ 5. Razorpay Subscription Checkout, Verification & Upgrades
{
  const db = createUniversalDb();
  const testSecret = "rzp_secret_production_test_999";
  let createdSubscription = null;

  const billingHandler = createBillingHandler({
    getDb: () => db,
    verify: async (token) => {
      if (token === "token_dan") return { uid: "user_dan", email: "dan@example.com", name: "Dan" };
      throw new Error("Invalid token");
    },
    env: () => ({
      RAZORPAY_KEY_ID: "rzp_test_danKey",
      RAZORPAY_KEY_SECRET: testSecret,
      RAZORPAY_PLAN_PRO_MONTHLY: "plan_dan_pro_monthly_999",
    }),
    makeStripe: () => ({}),
    makeRazorpay: () => ({
      listPlans: async () => ({ items: [] }),
      getPlan: async () => ({}),
      createSubscription: async (subArgs) => {
        createdSubscription = subArgs;
        return { id: "sub_dan_pro_999", short_url: "https://rzp.io/i/danProSub" };
      },
      getSubscription: async (id) => ({
        id,
        status: "active",
        current_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        customer_id: "cust_dan_999",
      }),
    }),
    serverTs: () => new Date(),
    now: () => Date.now(),
  });

  // A. Checkout uses configured Razorpay plan ID
  let res = await callJson(billingHandler, {
    method: "POST",
    headers: { Authorization: "Bearer token_dan" },
    query: { action: "checkout" },
    body: { plan: "pro", interval: "monthly", provider: "razorpay" },
  });
  assert.equal(res.code, 200);
  assert.equal(res.body.url, "https://rzp.io/i/danProSub");
  assert.equal(res.body.subscriptionId, "sub_dan_pro_999");
  assert.equal(res.body.keyId, "rzp_test_danKey");
  assert.equal(createdSubscription.planId, "plan_dan_pro_monthly_999");
  ok("Razorpay checkout creates subscription with configured plan ID and returns checkout credentials");

  // B. Verify payment signature: tampered signature rejected
  res = await callJson(billingHandler, {
    method: "POST",
    headers: { Authorization: "Bearer token_dan" },
    query: { action: "verify-razorpay" },
    body: {
      razorpay_payment_id: "pay_test_123",
      razorpay_subscription_id: "sub_dan_pro_999",
      razorpay_signature: "tampered_signature_abc",
      plan: "pro",
      interval: "monthly",
    },
  });
  assert.equal(res.code, 400);
  assert.equal(res.body.error, "invalid_signature");
  ok("client payment verification rejects invalid/tampered cryptographic signature");

  // C. Verify payment signature: valid signature activates Pro plan
  const validPaymentId = "pay_dan_valid_456";
  const validSubId = "sub_dan_pro_999";
  const validSig = crypto.createHmac("sha256", testSecret).update(`${validPaymentId}|${validSubId}`).digest("hex");

  res = await callJson(billingHandler, {
    method: "POST",
    headers: { Authorization: "Bearer token_dan" },
    query: { action: "verify-razorpay" },
    body: {
      razorpay_payment_id: validPaymentId,
      razorpay_subscription_id: validSubId,
      razorpay_signature: validSig,
      plan: "pro",
      interval: "monthly",
    },
  });
  assert.equal(res.code, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.plan, "pro");
  assert.equal(res.body.status, "active");
  ok("valid payment signature verification activates plan instantly");

  // D. Verify Dan's user document in database now has Pro entitlements
  const danDoc = (await db.collection("users").doc("user_dan").get()).data();
  assert.equal(danDoc.plan, "pro");
  assert.equal(danDoc.planStatus, "active");
  assert.equal(danDoc.ent.plan, "pro");
  assert.equal(danDoc.ent.dynamicQrs, 50);
  assert.equal(danDoc.ent.monthlyScans, 20000);
  assert.equal(danDoc.ent.password, true);
  ok("user account document reflects upgraded plan, limits, and entitlements");

  // E. GET /api/billing?action=me reflects Pro plan
  res = await callJson(billingHandler, {
    method: "GET",
    headers: { Authorization: "Bearer token_dan" },
    query: { action: "me" },
  });
  assert.equal(res.code, 200);
  assert.equal(res.body.plan, "pro");
  assert.equal(res.body.status, "active");
  assert.equal(res.body.limits.dynamicQrs, 50);
  assert.equal(res.body.features.password, true);
  ok("GET ?action=me immediately reflects active upgraded subscription");
}

// ------------------------------------------------------------------ 6. Safe Billing Diagnostics, Strict Plan Validation & Explicit Mode Control
{
  const db = createUniversalDb();
  const testSecret = "rzp_secret_production_test_888";

  const liveAccountPlans = [
    {
      id: "plan_test_pro_m_real",
      period: "monthly",
      interval: 1,
      item: { name: "Pro Monthly", amount: 29900, currency: "INR", active: true },
    },
    {
      id: "plan_test_biz_m_real",
      period: "monthly",
      interval: 1,
      item: { name: "Business Monthly", amount: 99900, currency: "INR", active: true },
    },
  ];

  let currentEnv = {
    RAZORPAY_KEY_ID: "rzp_test_myValidKey123",
    RAZORPAY_KEY_SECRET: testSecret,
    RAZORPAY_PLAN_PRO_MONTHLY: " plan_invalid_id_from_other_account ", // Contains spaces & invalid ID
  };

  const handler = createBillingHandler({
    getDb: () => db,
    verify: async () => ({ uid: "user_test_diag", email: "diag@example.com" }),
    env: () => currentEnv,
    makeStripe: () => ({}),
    makeRazorpay: (creds) => ({
      keyId: creds?.keyId,
      keySecret: creds?.keySecret,
      listPlans: async () => ({ items: liveAccountPlans }),
      getPlan: async (id) => {
        const found = liveAccountPlans.find((p) => p.id === id);
        if (found) return found;
        throw new Error("The ID provided is invalid or could not be found.");
      },
      createSubscription: async ({ planId, uid, plan, interval }) => {
        if (planId === "plan_invalid_id_from_other_account") {
          const err = new Error("The ID provided is invalid or could not be found.");
          err.status = 400;
          throw err;
        }
        return { id: `sub_real_${planId}`, short_url: `https://rzp.io/i/${planId}` };
      },
    }),
    serverTs: () => new Date(),
    now: () => Date.now(),
  });

  // A. Diagnostics reports key mode, prefix type, invalid configured plan, and available account plans
  let res = await callJson(handler, {
    method: "GET",
    query: { action: "diagnose" },
  });
  assert.equal(res.code, 200);
  assert.equal(res.body.razorpay.keyMode, "test");
  assert.equal(res.body.razorpay.keyPrefix, "rzp_test_");
  assert.equal(res.body.razorpay.authStatus, "authenticated");
  assert.equal(res.body.razorpay.accountPlans.length, 2);
  assert.equal(res.body.razorpay.configuredPlans.pro_monthly.isSet, true);
  assert.equal(res.body.razorpay.configuredPlans.pro_monthly.valid, false);
  assert.ok(res.body.razorpay.recommendations.length > 0);
  ok("GET ?action=diagnose accurately identifies invalid plan and reports prefix/mode");

  // B. Checkout with invalid plan ID rejects with HTTP 400 and does NOT silently select plans by price
  res = await callJson(handler, {
    method: "POST",
    headers: { Authorization: "Bearer test_token" },
    query: { action: "checkout" },
    body: { plan: "pro", interval: "monthly", provider: "razorpay" },
  });
  assert.equal(res.code, 400);
  assert.equal(res.body.error, "invalid_plan_id");
  assert.equal(res.body.configuredVar, "RAZORPAY_PLAN_PRO_MONTHLY");
  assert.equal(res.body.keyMode, "test");
  assert.equal(res.body.keyPrefix, "rzp_test_");
  assert.ok(res.body.message.includes("is invalid"));
  ok("checkout rejects invalid plan ID without silent price substitution");

  // C. Checkout with verified matching plan ID succeeds without substitution
  currentEnv.RAZORPAY_PLAN_PRO_MONTHLY = "plan_test_pro_m_real";
  res = await callJson(handler, {
    method: "POST",
    headers: { Authorization: "Bearer test_token" },
    query: { action: "checkout" },
    body: { plan: "pro", interval: "monthly", provider: "razorpay" },
  });
  assert.equal(res.code, 200);
  assert.equal(res.body.url, "https://rzp.io/i/plan_test_pro_m_real");
  assert.equal(res.body.subscriptionId, "sub_real_plan_test_pro_m_real");
  ok("checkout creates subscription strictly with configured verified plan ID");

  // D. Explicit RAZORPAY_MODE=test configuration and credential isolation
  const { getRazorpayCredentials, getSafeCredentialFingerprint } = await import("../api/_lib/providers.js");
  
  // SHA-256 fingerprint should never expose secret
  const fp = getSafeCredentialFingerprint("my_super_secret_key_12345");
  assert.equal(fp.length, 8);
  assert.ok(!fp.includes("secret"));

  // D1. RAZORPAY_MODE=test strictly rejects Live key and NEVER falls back
  const testModeWithLiveKey = getRazorpayCredentials({
    RAZORPAY_MODE: "test",
    RAZORPAY_KEY_ID: "rzp_live_1234567890abcdef",
    RAZORPAY_KEY_SECRET: "live_secret_value_12345",
  });
  assert.equal(testModeWithLiveKey.configuredMode, "test");
  assert.equal(testModeWithLiveKey.selectedMode, "test");
  assert.equal(testModeWithLiveKey.modeConflict, true);
  assert.equal(testModeWithLiveKey.keyId, ""); // strictly rejected!
  assert.ok(testModeWithLiveKey.modeError.includes("rejected"));
  ok("RAZORPAY_MODE=test strictly rejects Live key and prevents live fallback");

  // D2. Checkout under mode conflict returns HTTP 400 mode_conflict
  currentEnv = {
    RAZORPAY_MODE: "test",
    RAZORPAY_KEY_ID: "rzp_live_1234567890abcdef",
    RAZORPAY_KEY_SECRET: "live_secret_value_12345",
    RAZORPAY_PLAN_PRO_MONTHLY: "plan_test_pro_m_real",
  };
  res = await callJson(handler, {
    method: "POST",
    headers: { Authorization: "Bearer test_token" },
    query: { action: "checkout" },
    body: { plan: "pro", interval: "monthly", provider: "razorpay" },
  });
  assert.equal(res.code, 400);
  assert.equal(res.body.error, "mode_conflict");
  assert.ok(res.body.message.includes("rejected"));
  ok("checkout refuses execution when RAZORPAY_MODE=test lacks Test Key credentials");

  // D3. RAZORPAY_MODE=test with test key succeeds
  const testModeWithTestKey = getRazorpayCredentials({
    RAZORPAY_MODE: "test",
    RAZORPAY_KEY_ID: "rzp_live_1234567890abcdef",
    RAZORPAY_KEY_SECRET: "live_secret_value_12345",
    RAZORPAY_TEST_KEY_ID: "rzp_test_testkey987654",
    RAZORPAY_TEST_KEY_SECRET: "test_secret_value_98765",
  });
  assert.equal(testModeWithTestKey.configuredMode, "test");
  assert.equal(testModeWithTestKey.selectedMode, "test");
  assert.equal(testModeWithTestKey.keyMode, "test");
  assert.equal(testModeWithTestKey.keyPrefix, "rzp_test_");
  assert.equal(testModeWithTestKey.keyId, "rzp_test_testkey987654");
  assert.equal(testModeWithTestKey.keySecret, "test_secret_value_98765");
  assert.equal(testModeWithTestKey.modeConflict, false);
  ok("RAZORPAY_MODE=test correctly selects Test credentials and ignores Live credentials");

  // D4. Auto mode with live key only
  const liveOnly = getRazorpayCredentials({
    RAZORPAY_KEY_ID: "rzp_live_1234567890abcdef",
    RAZORPAY_KEY_SECRET: "live_secret_value_12345",
  });
  assert.equal(liveOnly.configuredMode, "auto");
  assert.equal(liveOnly.keyMode, "live");
  assert.equal(liveOnly.keyPrefix, "rzp_live_");
  assert.equal(liveOnly.keyId, "rzp_live_1234567890abcdef");
  assert.equal(liveOnly.keySourceVar, "RAZORPAY_KEY_ID");

  // D5. Auto mode with both: prioritizes test key
  const liveAndTest = getRazorpayCredentials({
    RAZORPAY_KEY_ID: "rzp_live_1234567890abcdef",
    RAZORPAY_KEY_SECRET: "live_secret_value_12345",
    RAZORPAY_TEST_KEY_ID: "rzp_test_testkey987654",
    RAZORPAY_TEST_KEY_SECRET: "test_secret_value_98765",
  });
  assert.equal(liveAndTest.keyMode, "test");
  assert.equal(liveAndTest.keyPrefix, "rzp_test_");
  assert.equal(liveAndTest.keyId, "rzp_test_testkey987654");
  assert.equal(liveAndTest.keySecret, "test_secret_value_98765");
  assert.equal(liveAndTest.keySourceVar, "RAZORPAY_TEST_KEY_ID");
  ok("getRazorpayCredentials safely prioritizes Test Mode credentials over Live credentials");
}

// ------------------------------------------------------------------ 7. Admin Unlimited Access & Platform Observability Verification
{
  const { getAdminUids, isAdminUid, getAdminEntitlements } = await import("../api/_lib/adminAuth.js");
  const { createAdminHandler } = await import("../api/_lib/admin.js");
  const { createQuota } = await import("../api/_lib/quota.js");

  const testEnv = {
    ADMIN_UIDS: "admin_super_uid_1, admin_super_uid_2",
    RAZORPAY_TEST_KEY_ID: "rzp_test_mockKey999",
    RAZORPAY_TEST_KEY_SECRET: "mockSecret888",
    RAZORPAY_PLAN_PRO_MONTHLY: "plan_test_pro_m",
    RAZORPAY_PLAN_PRO_YEARLY: "plan_test_pro_y",
    RAZORPAY_PLAN_BUSINESS_MONTHLY: "plan_test_biz_m",
    RAZORPAY_PLAN_BUSINESS_YEARLY: "plan_test_biz_y",
  };
  process.env.ADMIN_UIDS = testEnv.ADMIN_UIDS;

  // A. Admin allowlist resolution
  const admins = getAdminUids(testEnv);
  assert.deepEqual(admins, ["admin_super_uid_1", "admin_super_uid_2"]);
  assert.equal(isAdminUid("admin_super_uid_1", testEnv), true);
  assert.equal(isAdminUid("normal_user_xyz", testEnv), false);
  ok("getAdminUids and isAdminUid correctly parse allowlist from environment");

  // B. Admin entitlements guarantee unlimited access across all capabilities
  const ent = getAdminEntitlements();
  assert.equal(ent.plan, "admin");
  assert.equal(ent.limits.dynamicQrs, 999999999);
  assert.equal(ent.limits.monthlyScans, 999999999);
  assert.equal(ent.limits.staticQrs, 999999999);
  assert.equal(ent.features.bulk, true);
  assert.equal(ent.features.password, true);
  assert.equal(ent.features.deviceTargeting, true);
  ok("getAdminEntitlements grants permanent unlimited access to all features and quotas");

  // C. Admin bypasses all quota and feature restrictions in Links API
  const db = createUniversalDb();
  let nextId = 500;
  const mockVerify = async (token) => {
    if (token === "token_admin") return { uid: "admin_super_uid_1", email: "admin@qrpro.com" };
    if (token === "token_regular") return { uid: "regular_user_bob", email: "bob@example.com" };
    throw new Error("Invalid token");
  };

  const linksHandler = createLinksHandler({
    getDb: () => db,
    verify: mockVerify,
    adminUids: () => admins,
    serverTs: () => new Date(),
    now: () => Date.now(),
    newId: () => `qr_${++nextId}`,
  });

  const authAdmin = { Authorization: "Bearer token_admin" };
  const authBob = { Authorization: "Bearer token_regular" };

  // Set regular user bob in db with Free plan
  await db.collection("users").doc("regular_user_bob").set({
    uid: "regular_user_bob",
    email: "bob@example.com",
    plan: "free",
    planStatus: "active",
  });

  // Regular user bob creates 3 dynamic QRs (Free limit = 3)
  for (let i = 1; i <= 3; i++) {
    const res = await callJson(linksHandler, {
      method: "POST",
      headers: authBob,
      query: { action: "create" },
      body: { link: { destination: `https://example.com/${i}`, label: `Bob QR ${i}`, kind: "redirect" } },
    });
    assert.equal(res.code, 200);
  }

  // Regular user bob tries 4th dynamic QR -> MUST fail with 402/403 limit_reached
  let bobLimitRes = await callJson(linksHandler, {
    method: "POST",
    headers: authBob,
    query: { action: "create" },
    body: { link: { destination: "https://example.com/4", label: "Bob QR 4", kind: "redirect" } },
  });
  assert.equal(bobLimitRes.code, 402);
  assert.equal(bobLimitRes.body.error, "limit_reached");
  ok("regular customer is strictly bounded by Free dynamic QR limit (3)");

  // Regular user bob tries password protection -> MUST fail with 402 feature_locked
  const validPwSpec = {
    salt: "a".repeat(32),
    hash: "b".repeat(64),
    iter: 100000,
  };
  let bobPwRes = await callJson(linksHandler, {
    method: "POST",
    headers: authBob,
    query: { action: "create" },
    body: {
      link: {
        destination: "https://example.com/secret",
        label: "Secret",
        kind: "redirect",
        password: validPwSpec,
      },
    },
  });
  assert.equal(bobPwRes.code, 402);
  assert.equal(bobPwRes.body.error, "feature_locked");
  ok("regular customer is strictly blocked from Pro features (password protection)");

  // Administrator creates 5 dynamic QRs (exceeding Free limit) -> ALL MUST SUCCEED
  for (let i = 1; i <= 5; i++) {
    const adminRes = await callJson(linksHandler, {
      method: "POST",
      headers: authAdmin,
      query: { action: "create" },
      body: { link: { destination: `https://admin.example.com/${i}`, label: `Admin QR ${i}`, kind: "redirect" } },
    });
    assert.equal(adminRes.code, 200);
    assert.ok(adminRes.body.id);
  }
  ok("administrator successfully creates dynamic QR codes beyond normal plan caps without payment");

  // Administrator creates password-protected and device-targeted QR -> SUCCEEDS
  const adminFeatureRes = await callJson(linksHandler, {
    method: "POST",
    headers: authAdmin,
    query: { action: "create" },
    body: {
      link: {
        destination: "https://admin.example.com/vault",
        label: "Admin Vault",
        kind: "redirect",
        password: validPwSpec,
        deviceTargeting: { ios: "https://apps.apple.com/app", android: "https://play.google.com/app" },
      },
    },
  });
  assert.equal(adminFeatureRes.code, 200);
  assert.ok(adminFeatureRes.body.id);
  ok("administrator successfully creates password-protected and device-targeted QR codes without feature lock");

  // Administrator creates batch QRs using create-many -> SUCCEEDS
  const adminBatchRes = await callJson(linksHandler, {
    method: "POST",
    headers: authAdmin,
    query: { action: "create-many" },
    body: {
      items: [
        { destination: "https://admin.example.com/batch1", label: "Batch 1", type: "url" },
        { destination: "https://admin.example.com/batch2", label: "Batch 2", type: "url" },
        { destination: "https://admin.example.com/batch3", label: "Batch 3", type: "url" },
      ],
    },
  });
  assert.equal(adminBatchRes.code, 200);
  assert.equal(adminBatchRes.body.ids.length, 3);
  ok("administrator successfully creates bulk batches of QR codes without feature locks");

  // D. Admin scan quota check
  const quota = createQuota({ getDb: () => db, increment: (n) => n, serverTs: () => new Date(), now: () => Date.now() });
  const adminQuota = await quota.check("admin_super_uid_1");
  assert.equal(adminQuota.ok, true);
  assert.equal(adminQuota.limit, Infinity);
  assert.equal(adminQuota.isAdmin, true);
  ok("quota.check permits unlimited scans for administrators");

  // E. Admin Panel API (/api/admin) verification
  const adminApi = createAdminHandler({
    getDb: () => db,
    verify: mockVerify,
    adminUids: () => admins,
    setAuthDisabled: async () => {},
    serverTs: () => new Date(),
    now: () => Date.now(),
  });

  // Non-admin calling /api/admin is rejected with HTTP 403
  const nonAdminRes = await callJson(adminApi, {
    method: "GET",
    headers: authBob,
    query: { action: "overview" },
  });
  assert.equal(nonAdminRes.code, 403);
  assert.equal(nonAdminRes.body.error, "not_admin");
  ok("GET /api/admin strictly forbids non-admin callers (HTTP 403 not_admin)");

  // Verified admin calling overview -> 200 with complete metrics
  const ovRes = await callJson(adminApi, {
    method: "GET",
    headers: authAdmin,
    query: { action: "overview" },
  });
  assert.equal(ovRes.code, 200);
  assert.ok(ovRes.body.users >= 2);
  assert.ok(ovRes.body.qrs >= 8);
  assert.equal(Array.isArray(ovRes.body.signupsByDay), true);
  assert.equal(Array.isArray(ovRes.body.qrsByDay), true);
  ok("GET /api/admin?action=overview returns accurate customer, QR, and trend metrics");

  // Verified admin calling users -> 200 with synced customer records
  const usersRes = await callJson(adminApi, {
    method: "GET",
    headers: authAdmin,
    query: { action: "users" },
  });
  assert.equal(usersRes.code, 200);
  assert.ok(usersRes.body.users.length >= 2);
  const bobDoc = usersRes.body.users.find((u) => u.uid === "regular_user_bob");
  assert.ok(bobDoc);
  assert.equal(bobDoc.qrs, 3);
  ok("GET /api/admin?action=users returns full customer list with accurate QR counts");

  // Verified admin calling links with ownerId filter
  const linksRes = await callJson(adminApi, {
    method: "GET",
    headers: authAdmin,
    query: { action: "links", ownerId: "admin_super_uid_1" },
  });
  assert.equal(linksRes.code, 200);
  assert.ok(linksRes.body.links.length >= 6);
  assert.ok(linksRes.body.links.every((l) => l.ownerId === "admin_super_uid_1"));
  ok("GET /api/admin?action=links supports ownerId filtering for customer drawer view");

  // Verified admin calling diagnostics
  const diagRes = await callJson(adminApi, {
    method: "GET",
    headers: authAdmin,
    query: { action: "diagnostics" },
  });
  assert.equal(diagRes.code, 200);
  assert.equal(diagRes.body.admin.configured, true);
  assert.equal(diagRes.body.admin.count, 2);
  assert.ok(diagRes.body.database.totalUsers >= 2);
  assert.ok(diagRes.body.database.totalLinks >= 8);
  ok("GET /api/admin?action=diagnostics reports gateway, admin configuration, and database stats");
}

console.log("\nAll production repair & verification tests passed!\n");
