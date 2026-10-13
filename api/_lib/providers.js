// api/_lib/providers.js — thin REST clients for Stripe and Razorpay.
// No SDKs on purpose: fewer dependencies, smaller cold starts, and they're easy to fake in tests.

import crypto from "node:crypto";

/** Clean quotes, spaces, and newlines from plan IDs and credentials. */
export function cleanPlanId(val) {
  if (!val || typeof val !== "string") return "";
  return val.trim().replace(/^['"`]|['"`]$/g, "").trim();
}

/** Safe masking for plan IDs (never prints full secret; shows prefix & suffix). */
export function maskPlanId(id) {
  if (!id || typeof id !== "string") return "(unset)";
  const s = cleanPlanId(id);
  if (s.length <= 8) return s;
  return `${s.slice(0, 8)}...${s.slice(-4)} (${s.length} chars)`;
}

/** Safe SHA-256 fingerprint (never prints secret; returns 8 hex characters). */
export function getSafeCredentialFingerprint(val) {
  if (!val || typeof val !== "string") return "(unset)";
  const clean = cleanPlanId(val);
  if (!clean) return "(unset)";
  return crypto.createHash("sha256").update(clean).digest("hex").slice(0, 8);
}

/** Resolves Razorpay credentials with smart mode handling (RAZORPAY_MODE=test vs live vs auto) and alias variable discovery. */
export function getRazorpayCredentials(env = process.env) {
  const e = env || {};

  // Mode configuration:
  // RAZORPAY_MODE can be "test" or "live". Default is "auto".
  const rawMode = cleanPlanId(e.RAZORPAY_MODE || e.RZP_MODE || e.PAYMENT_MODE || "").toLowerCase();
  const configuredMode = rawMode === "test" ? "test" : rawMode === "live" ? "live" : "auto";

  // 1. Explicit test key candidates
  const testKeyNames = [
    "RAZORPAY_TEST_KEY_ID",
    "RAZORPAY_KEY_ID_TEST",
    "RZP_TEST_KEY_ID",
    "RAZORPAY_TEST_ID",
  ];
  let testKey = "";
  let testKeyVar = "";
  for (const k of testKeyNames) {
    const val = cleanPlanId(e[k]);
    if (val) {
      testKey = val;
      testKeyVar = k;
      break;
    }
  }

  // 2. Standard key candidates
  const stdKeyNames = [
    "RAZORPAY_KEY_ID",
    "RZP_KEY_ID",
    "RAZORPAY_ID",
    "RAZORPAY_API_KEY",
  ];
  let stdKey = "";
  let stdKeyVar = "";
  for (const k of stdKeyNames) {
    const val = cleanPlanId(e[k]);
    if (val) {
      stdKey = val;
      stdKeyVar = k;
      break;
    }
  }

  // If RAZORPAY_KEY_ID begins with rzp_test_, treat it as testKey
  if (!testKey && stdKey && stdKey.startsWith("rzp_test_")) {
    testKey = stdKey;
    testKeyVar = stdKeyVar;
  }

  // 3. Auto-scan env for any variable holding an rzp_test_ key if not yet found
  let discoveredTestKey = "";
  let discoveredTestKeyVar = "";
  if (!testKey) {
    for (const [k, v] of Object.entries(e)) {
      if (/^(RAZORPAY|RZP)/i.test(k) && typeof v === "string") {
        const cleaned = cleanPlanId(v);
        if (cleaned.startsWith("rzp_test_")) {
          discoveredTestKey = cleaned;
          discoveredTestKeyVar = k;
          break;
        }
      }
    }
  }

  const effectiveTestKey = testKey || discoveredTestKey;
  const effectiveTestKeyVar = testKeyVar || discoveredTestKeyVar;

  // 4. Test secret candidates
  const testSecretNames = [
    "RAZORPAY_TEST_KEY_SECRET",
    "RAZORPAY_KEY_SECRET_TEST",
    "RAZORPAY_TEST_SECRET",
    "RZP_TEST_KEY_SECRET",
    "RZP_TEST_SECRET",
  ];
  let testSecret = "";
  let testSecretVar = "";
  for (const k of testSecretNames) {
    const val = cleanPlanId(e[k]);
    if (val) {
      testSecret = val;
      testSecretVar = k;
      break;
    }
  }

  // 5. Standard secret candidates
  const stdSecretNames = [
    "RAZORPAY_KEY_SECRET",
    "RZP_KEY_SECRET",
    "RAZORPAY_SECRET",
    "RAZORPAY_API_SECRET",
  ];
  let stdSecret = "";
  let stdSecretVar = "";
  for (const k of stdSecretNames) {
    const val = cleanPlanId(e[k]);
    if (val) {
      stdSecret = val;
      stdSecretVar = k;
      break;
    }
  }

  // If effectiveTestKey matches stdKey and testSecret isn't explicitly set, pair with stdSecret
  if (!testSecret && effectiveTestKey && effectiveTestKey === stdKey) {
    testSecret = stdSecret;
    testSecretVar = stdSecretVar;
  }

  // Auto-scan env for test secret if not found
  if (!testSecret) {
    for (const [k, v] of Object.entries(e)) {
      if (/^(RAZORPAY|RZP).*test.*secret/i.test(k) && typeof v === "string") {
        const cleaned = cleanPlanId(v);
        if (cleaned) {
          testSecret = cleaned;
          testSecretVar = k;
          break;
        }
      }
    }
  }

  // 6. Webhook secret candidates
  const webhookSecretNames = [
    "RAZORPAY_WEBHOOK_SECRET",
    "RAZORPAY_TEST_WEBHOOK_SECRET",
    "RZP_WEBHOOK_SECRET",
    "RZP_TEST_WEBHOOK_SECRET",
  ];
  let webhookSecret = "";
  let webhookSecretVar = "";
  for (const k of webhookSecretNames) {
    const val = cleanPlanId(e[k]);
    if (val) {
      webhookSecret = val;
      webhookSecretVar = k;
      break;
    }
  }

  // 7. Live key candidates (excluding test keys)
  let liveKey = "";
  let liveKeyVar = "";
  if (stdKey && stdKey.startsWith("rzp_live_")) {
    liveKey = stdKey;
    liveKeyVar = stdKeyVar;
  } else {
    for (const [k, v] of Object.entries(e)) {
      if (/^(RAZORPAY|RZP)/i.test(k) && typeof v === "string") {
        const cleaned = cleanPlanId(v);
        if (cleaned.startsWith("rzp_live_")) {
          liveKey = cleaned;
          liveKeyVar = k;
          break;
        }
      }
    }
  }

  let liveSecret = "";
  let liveSecretVar = "";
  if (liveKey && stdSecret && !testSecretNames.includes(stdSecretVar)) {
    liveSecret = stdSecret;
    liveSecretVar = stdSecretVar;
  }

  // Mode Resolution:
  let activeKey = "";
  let activeKeyVar = "";
  let activeSecret = "";
  let activeSecretVar = "";
  let selectedMode = "unset";
  let modeConflict = false;
  let modeError = "";

  if (configuredMode === "test") {
    selectedMode = "test";
    if (effectiveTestKey) {
      activeKey = effectiveTestKey;
      activeKeyVar = effectiveTestKeyVar;
      activeSecret = testSecret || stdSecret;
      activeSecretVar = testSecret ? testSecretVar : stdSecretVar;
    } else {
      // STRICT TEST MODE: Never fall back to live key!
      modeConflict = true;
      if (liveKey) {
        modeError = `RAZORPAY_MODE is set to 'test', but no Test Key (rzp_test_...) was found. Live key (${maskPlanId(liveKey)}) in ${liveKeyVar} was rejected to prevent accidental live charges. Set RAZORPAY_TEST_KEY_ID (or set RAZORPAY_KEY_ID to an rzp_test_... key) and RAZORPAY_TEST_KEY_SECRET in Railway.`;
      } else {
        modeError = `RAZORPAY_MODE is set to 'test', but no Test Key (rzp_test_...) was found in environment. Set RAZORPAY_TEST_KEY_ID and RAZORPAY_TEST_KEY_SECRET in Railway.`;
      }
    }
  } else if (configuredMode === "live") {
    selectedMode = "live";
    if (liveKey) {
      activeKey = liveKey;
      activeKeyVar = liveKeyVar;
      activeSecret = liveSecret || stdSecret;
      activeSecretVar = liveSecret ? liveSecretVar : stdSecretVar;
    } else {
      // STRICT LIVE MODE: Never fall back to test key!
      modeConflict = true;
      if (effectiveTestKey) {
        modeError = `RAZORPAY_MODE is set to 'live', but only a Test Key (${maskPlanId(effectiveTestKey)}) was found in ${effectiveTestKeyVar}. Test keys cannot be used in Live Mode.`;
      } else {
        modeError = `RAZORPAY_MODE is set to 'live', but no Live Key (rzp_live_...) was found in environment.`;
      }
    }
  } else {
    // configuredMode === "auto":
    // Prioritize Test Key if available
    if (effectiveTestKey) {
      selectedMode = "test";
      activeKey = effectiveTestKey;
      activeKeyVar = effectiveTestKeyVar;
      activeSecret = testSecret || stdSecret;
      activeSecretVar = testSecret ? testSecretVar : stdSecretVar;
    } else if (stdKey) {
      activeKey = stdKey;
      activeKeyVar = stdKeyVar;
      activeSecret = stdSecret || testSecret;
      activeSecretVar = stdSecret ? stdSecretVar : testSecretVar;
      selectedMode = activeKey.startsWith("rzp_test_")
        ? "test"
        : activeKey.startsWith("rzp_live_")
        ? "live"
        : "unknown";
    }
  }

  const keyMode = activeKey.startsWith("rzp_test_")
    ? "test"
    : activeKey.startsWith("rzp_live_")
    ? "live"
    : activeKey
    ? "unknown"
    : "unset";

  const keyPrefix = activeKey.startsWith("rzp_test_")
    ? "rzp_test_"
    : activeKey.startsWith("rzp_live_")
    ? "rzp_live_"
    : activeKey
    ? activeKey.slice(0, 8)
    : "none";

  return {
    keyId: activeKey,
    keySecret: activeSecret,
    webhookSecret,
    keyMode,
    keyPrefix,
    configuredMode,
    selectedMode,
    modeConflict,
    modeError,
    keySourceVar: activeKeyVar,
    secretSourceVar: activeSecretVar,
    webhookSecretSourceVar: webhookSecretVar,
    hasTestCredentials: !!effectiveTestKey,
    hasLiveCredentials: !!liveKey,
    liveKeyPreview: maskPlanId(liveKey),
    liveKeyVar,
  };
}

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

/** Standard env var name for a provider's price/plan id, e.g. STRIPE_PRICE_PRO_MONTHLY / RAZORPAY_PLAN_BUSINESS_YEARLY */
export const planEnvKey = (provider, plan, interval) =>
  `${provider === "stripe" ? "STRIPE_PRICE" : "RAZORPAY_PLAN"}_${plan.toUpperCase()}_${interval.toUpperCase()}`;

/** Resolves Razorpay plan configuration checking standard and common alias variable names. */
export function getRazorpayPlanEnvConfig(env, plan, interval) {
  const p = plan.toUpperCase();
  const i = interval.toUpperCase();
  const primaryKey = `RAZORPAY_PLAN_${p}_${i}`;
  const candidates = [
    primaryKey,
    `RAZORPAY_TEST_PLAN_${p}_${i}`,
    `RAZORPAY_PLAN_${p}_${i}_TEST`,
    `RAZORPAY_PLAN_${p}`,
    `RAZORPAY_TEST_PLAN_${p}`,
    `RAZORPAY_PLAN_${p}_TEST`,
    `RAZORPAY_${p}_${i}`,
    `RAZORPAY_TEST_${p}_${i}`,
    `RAZORPAY_PLAN_ID_${p}_${i}`,
    `RAZORPAY_PLAN_ID_${p}`,
  ];
  for (const k of candidates) {
    const val = cleanPlanId(env[k]);
    if (val) return { key: k, value: val, isPrimary: k === primaryKey };
  }
  return { key: primaryKey, value: "", isPrimary: true };
}

/** Reverse lookup: provider price/plan id -> { plan, interval } (used by webhooks). */
export function lookupPlanByProviderId(provider, id, env) {
  const cleanId = cleanPlanId(id);
  if (!cleanId) return null;
  for (const plan of ["pro", "business"]) {
    for (const interval of ["monthly", "yearly"]) {
      if (provider === "stripe") {
        if (cleanPlanId(env[planEnvKey("stripe", plan, interval)]) === cleanId) return { plan, interval };
      } else if (provider === "razorpay") {
        const cfg = getRazorpayPlanEnvConfig(env, plan, interval);
        if (cfg.value === cleanId) return { plan, interval };
      }
    }
  }
  return null;
}

async function parse(res) {
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* keep {} */ }
  if (!res.ok) {
    const msg = data?.error?.description || data?.error?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.code = data?.error?.code;
    err.details = data?.error;
    throw err;
  }
  return data;
}

export function createStripe({ secret, fetchImpl = fetch }) {
  const cleanSecret = cleanPlanId(secret);
  const call = (path, params, method = "POST") =>
    fetchImpl(`https://api.stripe.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${cleanSecret}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: method === "GET" ? undefined : formEncode(params || {}),
    }).then(parse);
  return {
    createCheckout: ({ priceId, uid, email, plan, interval, customerId, successUrl, cancelUrl }) =>
      call("/v1/checkout/sessions", {
        mode: "subscription",
        line_items: [{ price: cleanPlanId(priceId), quantity: 1 }],
        client_reference_id: uid,
        ...(customerId ? { customer: customerId } : { customer_email: email || undefined }),
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: "true",
        metadata: { uid, plan, interval },
        subscription_data: { metadata: { uid, plan, interval } },
      }),
    createPortal: ({ customerId, returnUrl }) => call("/v1/billing_portal/sessions", { customer: customerId, return_url: returnUrl }),
    getSubscription: (id) => call(`/v1/subscriptions/${encodeURIComponent(cleanPlanId(id))}`, null, "GET"),
    setCancelAtPeriodEnd: (id, value) => call(`/v1/subscriptions/${encodeURIComponent(cleanPlanId(id))}`, { cancel_at_period_end: value ? "true" : "false" }),
  };
}

export function createRazorpay({ keyId, keySecret, fetchImpl = fetch }) {
  const cleanKey = cleanPlanId(keyId);
  const cleanSecret = cleanPlanId(keySecret);
  const auth = "Basic " + Buffer.from(`${cleanKey}:${cleanSecret}`).toString("base64");
  const call = (path, body, method = "POST") =>
    fetchImpl(`https://api.razorpay.com${path}`, {
      method,
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body || {}),
    }).then(parse);
  return {
    keyId: cleanKey,
    keySecret: cleanSecret,
    keyMode: cleanKey.startsWith("rzp_test_") ? "test" : cleanKey.startsWith("rzp_live_") ? "live" : cleanKey ? "unknown" : "unset",
    getPlan: (id) => call(`/v1/plans/${encodeURIComponent(cleanPlanId(id))}`, null, "GET"),
    listPlans: (count = 50) => call(`/v1/plans?count=${count}`, null, "GET"),
    createPlan: ({ period, interval = 1, name, amount, currency = "INR", description = "" }) =>
      call("/v1/plans", {
        period,
        interval,
        item: { name, amount, currency, description },
      }),
    createSubscription: ({ planId, uid, plan, interval }) =>
      call("/v1/subscriptions", {
        plan_id: cleanPlanId(planId),
        total_count: interval === "yearly" ? 10 : 120, // Razorpay needs a cycle count; this is "effectively until cancelled"
        customer_notify: 1,
        notes: { uid, plan, interval },
      }),
    getSubscription: (id) => call(`/v1/subscriptions/${encodeURIComponent(cleanPlanId(id))}`, null, "GET"),
    cancelAtCycleEnd: (id) => call(`/v1/subscriptions/${encodeURIComponent(cleanPlanId(id))}/cancel`, { cancel_at_cycle_end: 1 }),
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
  const cleanPayment = cleanPlanId(paymentId);
  const cleanSub = cleanPlanId(subscriptionId);
  const cleanSec = cleanPlanId(secret);
  const want = crypto.createHmac("sha256", cleanSec).update(`${cleanPayment}|${cleanSub}`).digest("hex");
  return safeEq(signature, want);
}
