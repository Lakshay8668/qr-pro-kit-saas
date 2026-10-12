// api/_lib/providers.js — thin REST clients for Stripe and Razorpay.
// No SDKs on purpose: fewer dependencies, smaller cold starts, and they're easy to fake in tests.

import crypto from "node:crypto";

/** Stripe wants application/x-www-form-urlencoded with bracketed nesting: a[b]=1&items[0][price]=x */
export function formEncode(obj, prefix = "", out = []) {
  Object.entries(obj).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" ? formEncode(x, `${key}[${i}]`, out) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(x)}`)));
    else if (typeof v === "object") formEncode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  });
  return out.join("&");
}

/** env var name for a provider's price/plan id, e.g. STRIPE_PRICE_PRO_MONTHLY / RAZORPAY_PLAN_BUSINESS_YEARLY */
export const planEnvKey = (provider, plan, interval) =>
  `${provider === "stripe" ? "STRIPE_PRICE" : "RAZORPAY_PLAN"}_${plan.toUpperCase()}_${interval.toUpperCase()}`;

/** Reverse lookup: provider price/plan id -> { plan, interval } (used by webhooks). */
export function lookupPlanByProviderId(provider, id, env) {
  for (const plan of ["pro", "business"]) {
    for (const interval of ["monthly", "yearly"]) {
      if (id && env[planEnvKey(provider, plan, interval)] === id) return { plan, interval };
    }
  }
  return null;
}

async function parse(res) {
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* keep {} */ }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error?.description || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function createStripe({ secret, fetchImpl = fetch }) {
  const call = (path, params, method = "POST") =>
    fetchImpl(`https://api.stripe.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: method === "GET" ? undefined : formEncode(params || {}),
    }).then(parse);
  return {
    createCheckout: ({ priceId, uid, email, plan, interval, customerId, successUrl, cancelUrl }) =>
      call("/v1/checkout/sessions", {
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: uid,
        ...(customerId ? { customer: customerId } : { customer_email: email || undefined }),
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: "true",
        metadata: { uid, plan, interval },
        subscription_data: { metadata: { uid, plan, interval } },
      }),
    createPortal: ({ customerId, returnUrl }) => call("/v1/billing_portal/sessions", { customer: customerId, return_url: returnUrl }),
    getSubscription: (id) => call(`/v1/subscriptions/${encodeURIComponent(id)}`, null, "GET"),
    setCancelAtPeriodEnd: (id, value) => call(`/v1/subscriptions/${encodeURIComponent(id)}`, { cancel_at_period_end: value ? "true" : "false" }),
  };
}

export function createRazorpay({ keyId, keySecret, fetchImpl = fetch }) {
  const auth = "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const call = (path, body, method = "POST") =>
    fetchImpl(`https://api.razorpay.com${path}`, {
      method,
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body || {}),
    }).then(parse);
  return {
    createPlan: ({ period, interval = 1, name, amount, currency = "INR", description = "" }) =>
      call("/v1/plans", {
        period,
        interval,
        item: { name, amount, currency, description },
      }),
    createSubscription: ({ planId, uid, plan, interval }) =>
      call("/v1/subscriptions", {
        plan_id: planId,
        total_count: interval === "yearly" ? 10 : 120, // Razorpay needs a cycle count; this is "effectively until cancelled"
        customer_notify: 1,
        notes: { uid, plan, interval },
      }),
    getSubscription: (id) => call(`/v1/subscriptions/${encodeURIComponent(id)}`, null, "GET"),
    cancelAtCycleEnd: (id) => call(`/v1/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: 1 }),
  };
}

// ------------------------------------------------------------------ webhook signatures
const safeEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** Stripe-Signature: t=<unix>,v1=<hmac>[,v1=...]  where hmac = HMAC_SHA256(secret, `${t}.${rawBody}`) */
export function verifyStripeSignature(raw, header, secret, now = Date.now(), toleranceSec = 300) {
  if (!raw || !header || !secret) return false;
  const parts = String(header).split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(now / 1000 - Number(t)) > toleranceSec) return false;
  const want = crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return sigs.some((s) => safeEq(s, want));
}

/** X-Razorpay-Signature = HMAC_SHA256(webhookSecret, rawBody) in hex */
export function verifyRazorpaySignature(raw, header, secret) {
  if (!raw || !header || !secret) return false;
  return safeEq(header, crypto.createHmac("sha256", secret).update(raw).digest("hex"));
}

/** Razorpay Subscription Checkout Signature: HMAC_SHA256(keySecret, `${payment_id}|${subscription_id}`) in hex */
export function verifySubscriptionPaymentSignature(paymentId, subscriptionId, signature, secret) {
  if (!paymentId || !subscriptionId || !signature || !secret) return false;
  const want = crypto.createHmac("sha256", secret).update(`${paymentId}|${subscriptionId}`).digest("hex");
  return safeEq(signature, want);
}
