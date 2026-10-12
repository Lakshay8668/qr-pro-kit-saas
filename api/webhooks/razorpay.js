// api/webhooks/razorpay.js — Razorpay -> POST https://YOUR-DOMAIN/api/webhooks/razorpay
// Events to enable: subscription.activated, subscription.charged, subscription.pending,
//                   subscription.halted, subscription.cancelled, subscription.completed, subscription.updated
import { readRaw } from "../_lib/raw.js";
import { verifyRazorpaySignature, getRazorpayCredentials } from "../_lib/providers.js";
import { createSubscriptionHandlers } from "../_lib/subscriptions.js";
import { getDb, serverTs } from "../_lib/firebaseAdmin.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") { res.statusCode = 405; return res.end("method not allowed"); }
  try {
    const raw = await readRaw(req);
    const creds = getRazorpayCredentials(process.env);
    const webhookSecret = creds.webhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("[Razorpay Webhook] RAZORPAY_WEBHOOK_SECRET is not configured in server environment variables.");
    }
    if (!verifyRazorpaySignature(raw, req.headers["x-razorpay-signature"], webhookSecret)) {
      console.warn("[Razorpay Webhook] Rejected webhook: signature mismatch or missing secret.");
      res.statusCode = 400;
      return res.end("bad signature");
    }
    const h = createSubscriptionHandlers({ getDb, serverTs, env: process.env });
    const result = await h.razorpayEvent(JSON.parse(raw), h.eventIdFor(raw, req.headers["x-razorpay-event-id"]));
    res.statusCode = 200;
    res.end(result);
  } catch (e) {
    console.error("razorpay webhook error", e);
    res.statusCode = 500;
    res.end("error");
  }
}
