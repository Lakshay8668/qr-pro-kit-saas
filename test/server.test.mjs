// test/server.test.mjs — tests for the native Node.js production server
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import server from "../server.js";

const ok = (m) => console.log(`  ✓ ${m}`);

let port;
function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `http://127.0.0.1:${port}${path}`,
      {
        method: options.method || "GET",
        headers: options.headers || {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let body = raw;
          try {
            body = JSON.parse(raw);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, body, raw });
        });
      }
    );
    req.on("error", reject);
    if (options.body) {
      req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

console.log("Running server.js tests...");

// Start server on an open ephemeral port
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
port = server.address().port;

// 1. Health checks
{
  const r1 = await request("/health");
  assert.equal(r1.status, 200);
  assert.equal(r1.body.ok, true);
  assert.equal(r1.body.status, "healthy");

  const r2 = await request("/api/health");
  assert.equal(r2.status, 200);
  assert.equal(r2.body.ok, true);
  ok("health check /health and /api/health return 200 OK");
}

// 2. CORS preflight
{
  const r = await request("/api/billing", {
    method: "OPTIONS",
    headers: { origin: "https://custom-domain.com" },
  });
  assert.equal(r.status, 204);
  assert.equal(r.headers["access-control-allow-origin"], "https://custom-domain.com");
  assert.ok(r.headers["access-control-allow-methods"]);
  ok("CORS preflight (OPTIONS) returns 204 with correct headers");
}

// 3. Public API: /api/billing?action=config
{
  const r = await request("/api/billing?action=config");
  assert.equal(r.status, 200);
  assert.ok(r.body.providers);
  assert.equal(typeof r.body.providers.razorpay, "boolean");
  assert.equal(typeof r.body.providers.stripe, "boolean");
  ok("GET /api/billing?action=config returns provider configuration");
}

// 4. Razorpay Webhook: verifies unconsumed raw stream & bad signature rejection
{
  const payload = JSON.stringify({ event: "subscription.activated", payload: {} });
  const r = await request("/api/webhooks/razorpay", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": "invalid_signature",
    },
    body: payload,
  });
  // Since webhook secret is not set or signature doesn't match, it must return 400 "bad signature"
  assert.equal(r.status, 400);
  assert.match(r.raw, /bad signature/i);
  ok("POST /api/webhooks/razorpay consumes raw stream and enforces HMAC verification");
}

// 5. Razorpay Webhook: valid signature verification
{
  process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret_123";
  const payload = JSON.stringify({
    event: "subscription.charged",
    created_at: 1700000000,
    payload: {
      subscription: {
        entity: {
          id: "sub_test_123",
          status: "active",
          plan_id: "plan_unknown",
          notes: { uid: "non_existent_user" },
        },
      },
    },
  });
  const validSig = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(payload).digest("hex");
  const r = await request("/api/webhooks/razorpay", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": validSig,
    },
    body: payload,
  });
  // The signature is verified; then subscription handler runs and either ignores or returns status
  assert.equal(r.status, 200);
  ok("POST /api/webhooks/razorpay accepts valid HMAC signature");
}

// 6. Unknown API endpoint returns 404 JSON
{
  const r = await request("/api/nonexistent");
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "not_found");
  ok("unknown /api/* endpoint returns 404 JSON");
}

// 7. Config endpoint
{
  const r = await request("/api/config");
  assert.equal(r.status, 200);
  assert.equal(typeof r.body, "object");
  assert.ok("apiKey" in r.body);
  assert.ok("projectId" in r.body);
  assert.ok("authDomain" in r.body);
  ok("GET /api/config returns safe public client config object");
}

// 8. Static asset and SPA fallback with injected config
{
  const r = await request("/pricing");
  assert.equal(r.status, 200);
  assert.ok(r.headers["content-type"].includes("text/html"));
  assert.ok(r.raw.includes("window.__APP_CONFIG__"));
  ok("SPA routes (/pricing) return 200 with window.__APP_CONFIG__ injected");
}

// Close server
server.close();
console.log("All server tests passed!\n");
