// api/webhooks/stripe.js — Stripe -> POST https://YOUR-DOMAIN/api/webhooks/stripe
// Events to enable: checkout.session.completed, customer.subscription.created,
//                   customer.subscription.updated, customer.subscription.deleted
import { readRaw } from "../_lib/raw.js";
import { verifyStripeSignature, createStripe } from "../_lib/providers.js";
import { createSubscriptionHandlers } from "../_lib/subscriptions.js";
import { getDb, serverTs } from "../_lib/firebaseAdmin.js";

export const config = { api: { bodyParser: false } }; // we need the raw bytes to check the signature

export default async function handler(req, res) {
  if (req.method !== "POST") { res.statusCode = 405; return res.end("method not allowed"); }
  try {
    const raw = await readRaw(req);
    if (!verifyStripeSignature(raw, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET)) {
      res.statusCode = 400;
      return res.end("bad signature");
    }
    const h = createSubscriptionHandlers({
      getDb, serverTs, env: process.env,
      stripe: () => createStripe({ secret: process.env.STRIPE_SECRET_KEY }),
    });
    const result = await h.stripeEvent(JSON.parse(raw));
    res.statusCode = 200;
    res.end(result);
  } catch (e) {
    console.error("stripe webhook error", e);
    res.statusCode = 500; // non-2xx => Stripe retries
    res.end("error");
  }
}
