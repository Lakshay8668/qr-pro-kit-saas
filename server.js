// server.js — Production HTTP server for Railway deployment
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, "dist");

// Lazy-load API route handlers
let billingHandler;
let linksHandler;
let adminHandler;
let redirectHandler;
let razorpayWebhookHandler;
let stripeWebhookHandler;

async function getHandlers() {
  if (!billingHandler) {
    const [b, l, a, q, rz, st] = await Promise.all([
      import("./api/billing.js").then((m) => m.default),
      import("./api/links.js").then((m) => m.default),
      import("./api/admin.js").then((m) => m.default),
      import("./api/q/[id].js").then((m) => m.default),
      import("./api/webhooks/razorpay.js").then((m) => m.default),
      import("./api/webhooks/stripe.js").then((m) => m.default),
    ]);
    billingHandler = b;
    linksHandler = l;
    adminHandler = a;
    redirectHandler = q;
    razorpayWebhookHandler = rz;
    stripeWebhookHandler = st;
  }
  return {
    billing: billingHandler,
    links: linksHandler,
    admin: adminHandler,
    redirect: redirectHandler,
    razorpayWebhook: razorpayWebhookHandler,
    stripeWebhook: stripeWebhookHandler,
  };
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Razorpay-Signature, Stripe-Signature, X-Razorpay-Event-Id");
  if (origin !== "*") {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 2_000_000) {
        reject(new Error("Request body too large"));
        req.destroy?.();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
    req.on("error", reject);
  });
}

function serveStaticFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const stat = fs.statSync(filePath);

  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", stat.size);
  if (filePath.includes(path.sep + "assets" + path.sep)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    res.setHeader("Cache-Control", "public, max-age=3600");
  }

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  req.query = Object.fromEntries(url.searchParams.entries());

  // 1. Health checks
  if (pathname === "/health" || pathname === "/api/health") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.end(
      JSON.stringify({
        ok: true,
        status: "healthy",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      })
    );
  }

  // 2. Dynamic QR redirect: /q/:id
  const qMatch = pathname.match(/^\/q\/([A-Za-z0-9_-]+)$/);
  if (qMatch) {
    req.query.id = qMatch[1];
    try {
      const handlers = await getHandlers();
      return await handlers.redirect(req, res);
    } catch (err) {
      console.error("Redirect handler error:", err);
      res.statusCode = 500;
      return res.end("Internal redirect error");
    }
  }

  // 3. Webhooks (Stream is NOT drained; readRaw consumes it)
  if (pathname === "/api/webhooks/razorpay") {
    try {
      const handlers = await getHandlers();
      return await handlers.razorpayWebhook(req, res);
    } catch (err) {
      console.error("Razorpay webhook handler error:", err);
      res.statusCode = 500;
      return res.end("Webhook execution error");
    }
  }

  if (pathname === "/api/webhooks/stripe") {
    try {
      const handlers = await getHandlers();
      return await handlers.stripeWebhook(req, res);
    } catch (err) {
      console.error("Stripe webhook handler error:", err);
      res.statusCode = 500;
      return res.end("Webhook execution error");
    }
  }

  // 4. API Routes (parse JSON body if POST/PUT/PATCH)
  if (pathname.startsWith("/api/")) {
    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      try {
        req.body = await readBody(req);
      } catch (err) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ error: "bad_request", message: "Invalid request body." }));
      }
    }

    try {
      const handlers = await getHandlers();
      if (pathname === "/api/billing") return await handlers.billing(req, res);
      if (pathname === "/api/links") return await handlers.links(req, res);
      if (pathname === "/api/admin") return await handlers.admin(req, res);
      if (pathname.startsWith("/api/q/")) {
        const idMatch = pathname.match(/^\/api\/q\/([A-Za-z0-9_-]+)$/);
        if (idMatch) req.query.id = idMatch[1];
        return await handlers.redirect(req, res);
      }

      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "not_found", message: "API endpoint not found." }));
    } catch (err) {
      console.error("API error:", err);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "server_error", message: err.message || "Internal server error." }));
    }
  }

  // 5. Static Assets & SPA Fallback
  if (fs.existsSync(DIST_DIR)) {
    const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, "");
    const filePath = path.join(DIST_DIR, safePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return serveStaticFile(filePath, res);
    }

    const indexPath = path.join(DIST_DIR, "index.html");
    if (fs.existsSync(indexPath)) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      return fs.createReadStream(indexPath).pipe(res);
    }
  }

  // Dist not built yet
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!DOCTYPE html><html><head><title>QR Pro Kit API</title></head><body style="font-family:system-ui,sans-serif;padding:40px;text-align:center;">
    <h2>QR Pro Kit API Server is running</h2>
    <p>Run <code>npm run build</code> to serve frontend assets.</p>
    <p><a href="/health">Health Check</a> | <a href="/api/billing?action=config">Billing Config</a></p>
  </body></html>`);
});

const isMain = process.argv[1] && (path.resolve(process.argv[1]) === __filename || process.argv[1].endsWith("server.js"));
if (isMain) {
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = "0.0.0.0";

  server.listen(PORT, HOST, () => {
    console.log(`[QR Pro Kit] Server listening on http://${HOST}:${PORT}`);
  });
}

export default server;
