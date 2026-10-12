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

console.log("\nAll production repair & verification tests passed!\n");
