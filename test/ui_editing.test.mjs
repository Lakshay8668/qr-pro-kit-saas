// test/ui_editing.test.mjs — Verification tests for Static & Dynamic QR editing and UI data pipeline
import assert from "node:assert/strict";
import { createUniversalDb } from "../api/_lib/db.js";
import { createLinksHandler } from "../api/_lib/links.js";
import { createHandler as createRedirectHandler } from "../api/_lib/handler.js";
import { callJson } from "./fakeDb.mjs";

const ok = (m) => console.log(`  ✓ ${m}`);

console.log("Running UI & QR Editing tests...");

// Mock token verifier
const mockVerify = async (token) => {
  if (token === "token_user_1") return { uid: "ui_user_1", email: "user1@example.com" };
  if (token === "token_user_2") return { uid: "ui_user_2", email: "user2@example.com" };
  throw new Error("Invalid token");
};

// ------------------------------------------------------------------ 1. Static QR Editing & Preservation
{
  const db = createUniversalDb();
  const linksApi = createLinksHandler({
    getDb: () => db,
    serverTs: () => new Date(),
    verify: mockVerify,
  });

  // Step 1: Create static QR
  const createRes = await callJson(linksApi, {
    method: "POST",
    headers: { authorization: "Bearer token_user_1" },
    query: { action: "create" },
    body: {
      link: {
        kind: "static",
        payload: "https://initial.example.com/promo",
        label: "Initial Static QR",
        type: "url",
        design: { fg: "#111827", bg: "#ffffff", shape: "square" },
      },
    },
  });
  assert.equal(createRes.code, 200);
  const staticId = createRes.body.id;
  assert.ok(staticId, "Static QR created with ID");
  ok("Static QR code created successfully");

  // Step 2: Edit Static QR label and design (colors, dot shape, frame)
  const updateRes = await callJson(linksApi, {
    method: "POST",
    headers: { authorization: "Bearer token_user_1" },
    query: { action: "update" },
    body: {
      id: staticId,
      patch: {
        label: "Updated Static Name",
        design: {
          fg: "#4f46e5",
          fg2: "#7c3aed",
          bg: "#f8fafc",
          shape: "dots",
          eye: "rounded",
          frameStyle: "text",
          frameText: "Scan Now",
        },
      },
    },
  });
  assert.equal(updateRes.code, 200);
  assert.equal(updateRes.body.ok, true);
  ok("Static QR label and design updated successfully");

  // Verify static record in DB
  const snap = await db.collection("links").doc(staticId).get();
  assert.equal(snap.data().label, "Updated Static Name");
  assert.equal(snap.data().design.fg, "#4f46e5");
  assert.equal(snap.data().design.shape, "dots");
  assert.equal(snap.data().design.frameText, "Scan Now");
  assert.equal(snap.data().payload, "https://initial.example.com/promo"); // Content preserved
  ok("Static QR payload preserved while label and styling updated");

  // Step 3: Explicit replacement generation: creates new static QR without deleting/overwriting original
  const replaceRes = await callJson(linksApi, {
    method: "POST",
    headers: { authorization: "Bearer token_user_1" },
    query: { action: "create" },
    body: {
      link: {
        kind: "static",
        payload: "https://new-target.example.com/v2",
        label: "Updated Static Name (v2)",
        type: "url",
        design: snap.data().design,
      },
    },
  });
  assert.equal(replaceRes.code, 200);
  const replacementId = replaceRes.body.id;
  assert.notEqual(replacementId, staticId, "Replacement QR has unique new ID");

  // Verify original static QR is intact
  const origSnap = await db.collection("links").doc(staticId).get();
  assert.equal(origSnap.exists, true);
  assert.equal(origSnap.data().payload, "https://initial.example.com/promo");

  // Verify replacement static QR exists with new payload
  const newSnap = await db.collection("links").doc(replacementId).get();
  assert.equal(newSnap.exists, true);
  assert.equal(newSnap.data().payload, "https://new-target.example.com/v2");
  ok("Replacement static QR created with new destination while original record is preserved intact");
}

// ------------------------------------------------------------------ 2. Dynamic QR Editing, Over-The-Air Redirect & Design
{
  const db = createUniversalDb();
  const linksApi = createLinksHandler({
    getDb: () => db,
    serverTs: () => new Date(),
    verify: mockVerify,
  });

  // Step 1: Create dynamic QR
  const createRes = await callJson(linksApi, {
    method: "POST",
    headers: { authorization: "Bearer token_user_1" },
    query: { action: "create" },
    body: {
      link: {
        kind: "redirect",
        destination: "https://old-summer-sale.com/deals",
        label: "Summer Promo 2026",
        type: "url",
        design: { fg: "#000000", bg: "#ffffff" },
      },
    },
  });
  assert.equal(createRes.code, 200);
  const dynId = createRes.body.id;
  ok("Dynamic QR code created with short ID: #" + dynId);

  // Setup redirect handler for /q/:id
  const redirectHandler = createRedirectHandler({
    getDb: () => db,
    secret: () => "test_secret_123",
    increment: (n) => ({ __inc: n }),
    serverTs: () => new Date(),
    now: () => Date.now(),
    quota: {
      check: async () => ({ ok: true }),
      record: async () => {},
    },
  });

  // Test scan on initial destination
  let redirectLocation = "";
  const req1 = { method: "GET", query: { id: dynId }, headers: { "user-agent": "Mozilla/5.0 (iPhone)" } };
  const res1 = {
    statusCode: 200,
    setHeader: (k, v) => { if (k.toLowerCase() === "location") redirectLocation = v; },
    end: () => {},
  };
  await redirectHandler(req1, res1);
  assert.equal(res1.statusCode, 302);
  assert.equal(redirectLocation, "https://old-summer-sale.com/deals");
  ok("Dynamic redirect initially routes to: " + redirectLocation);

  // Step 2: Edit dynamic QR destination and design via authenticated API
  const updateRes = await callJson(linksApi, {
    method: "POST",
    headers: { authorization: "Bearer token_user_1" },
    query: { action: "update" },
    body: {
      id: dynId,
      patch: {
        destination: "https://new-autumn-campaign.com/launch",
        label: "Autumn Launch 2026",
        design: {
          fg: "#4f46e5",
          fg2: "#06b6d4",
          bg: "#ffffff",
          shape: "rounded",
          frameStyle: "bar",
          frameText: "Exclusive Deals",
        },
      },
    },
  });
  assert.equal(updateRes.code, 200);
  assert.equal(updateRes.body.ok, true);
  ok("Dynamic QR destination and styling updated via API");

  // Step 3: Verify dynamic redirect now immediately routes to NEW destination without changing short ID
  redirectLocation = "";
  const req2 = { method: "GET", query: { id: dynId }, headers: { "user-agent": "Mozilla/5.0 (Android)" } };
  const res2 = {
    statusCode: 200,
    setHeader: (k, v) => { if (k.toLowerCase() === "location") redirectLocation = v; },
    end: () => {},
  };
  await redirectHandler(req2, res2);
  assert.equal(res2.statusCode, 302);
  assert.equal(redirectLocation, "https://new-autumn-campaign.com/launch");
  ok("Dynamic redirect seamlessly updated over-the-air to: " + redirectLocation);

  // Step 4: Verify scan counter incremented on the same permanent record
  const dynSnap = await db.collection("links").doc(dynId).get();
  assert.equal(dynSnap.data().scans, 2);
  assert.equal(dynSnap.data().destination, "https://new-autumn-campaign.com/launch");
  assert.equal(dynSnap.data().label, "Autumn Launch 2026");
  assert.equal(dynSnap.data().design.frameText, "Exclusive Deals");
  ok("Historical scan counter (2) and permanent short ID preserved after destination edit");

  // Step 5: Test Pause and Resume
  await callJson(linksApi, {
    method: "POST",
    headers: { authorization: "Bearer token_user_1" },
    query: { action: "update" },
    body: { id: dynId, patch: { active: false } },
  });
  const resPaused = { statusCode: 200, setHeader: () => {}, end: () => {} };
  await redirectHandler({ method: "GET", query: { id: dynId }, headers: {} }, resPaused);
  assert.equal(resPaused.statusCode, 403);
  ok("Paused dynamic QR returns 403 notice as expected");

  await callJson(linksApi, {
    method: "POST",
    headers: { authorization: "Bearer token_user_1" },
    query: { action: "update" },
    body: { id: dynId, patch: { active: true } },
  });
  let resumedLocation = "";
  const resResumed = {
    statusCode: 200,
    setHeader: (k, v) => {
      if (k.toLowerCase() === "location") resumedLocation = v;
    },
    end: () => {},
  };
  await redirectHandler({ method: "GET", query: { id: dynId }, headers: {} }, resResumed);
  assert.equal(resResumed.statusCode, 302);
  assert.equal(resResumed.headers?.location || resumedLocation, "https://new-autumn-campaign.com/launch");
  ok("Resumed dynamic QR immediately restores redirection");
}

console.log("All UI & QR Editing tests passed!");
