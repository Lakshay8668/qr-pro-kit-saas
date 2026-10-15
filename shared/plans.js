// shared/plans.js — the ONE place that defines plans, limits and "who is entitled to what".
// Imported by the browser (pricing page, usage meters) AND by the Vercel functions
// (limit enforcement, webhooks), so the UI can never disagree with the server.
//
// Prices below are what the pricing page DISPLAYS. The amount actually charged is whatever
// you configured on the Stripe Price / Razorpay Plan referenced in your env vars — keep them in sync.

export const CURRENCY = { code: "INR", symbol: "₹" };
export const PLAN_ORDER = ["free", "pro", "business"];
export const INTERVALS = ["monthly", "yearly"];

export const PLANS = {
  free: {
    id: "free",
    name: "Free",
    tagline: "Try editable QR codes",
    price: { monthly: 0, yearly: 0 },
    limits: { dynamicQrs: 1, staticQrs: 50, monthlyScans: 500 },
    features: { password: false, deviceTargeting: false, bulk: false },
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "For creators and small shops",
    price: { monthly: 299, yearly: 2990 },
    limits: { dynamicQrs: 50, staticQrs: 500, monthlyScans: 20000 },
    features: { password: true, deviceTargeting: true, bulk: true },
  },
  business: {
    id: "business",
    name: "Business",
    tagline: "For agencies, chains and campaigns",
    price: { monthly: 999, yearly: 9990 },
    limits: { dynamicQrs: 500, staticQrs: 5000, monthlyScans: 200000 },
    features: { password: true, deviceTargeting: true, bulk: true },
  },
  admin: {
    id: "admin",
    name: "Admin Unlimited",
    tagline: "Unrestricted Master Access",
    price: { monthly: 0, yearly: 0 },
    limits: { dynamicQrs: 999999999, staticQrs: 999999999, monthlyScans: 999999999 },
    features: { password: true, deviceTargeting: true, bulk: true },
  },
};

export const FEATURE_LABELS = {
  password: "Password-protected QR codes",
  deviceTargeting: "Per-device (iOS / Android) redirects",
  bulk: "Bulk QR creation (CSV → ZIP)",
};

export const LIMIT_LABELS = {
  dynamicQrs: "editable (dynamic) QR codes",
  staticQrs: "saved static QR codes",
  monthlyScans: "tracked scans per month",
};

export const formatLimitLabel = (k, count) => {
  if (k === "dynamicQrs") return count === 1 ? "editable (dynamic) QR code" : "editable (dynamic) QR codes";
  if (k === "staticQrs") return count === 1 ? "saved static QR code" : "saved static QR codes";
  if (k === "monthlyScans") return count === 1 ? "tracked scan per month" : "tracked scans per month";
  return LIMIT_LABELS[k] || k;
};

export const isPaidPlan = (id) => id === "pro" || id === "business";
export const isInterval = (v) => INTERVALS.includes(v);

const DAY = 86400000;
// Access rules (see README "Billing lifecycle"):
//  active    -> entitled (a few days of slack if a renewal webhook is late)
//  canceled  -> entitled until the period that was already paid for ends
//  past_due  -> entitled for a short grace period while the provider retries the card
export const GRACE_DAYS = { renewal: 3, pastDue: 5 };

/** Which plan is the user ACTUALLY entitled to right now (falls back to "free"). */
export function effectivePlanId(u, now = Date.now()) {
  if (u?.isAdmin || u?.plan === "admin") return "admin";
  const plan = PLANS[u?.plan] ? u.plan : "free";
  if (plan === "free") return "free";
  const status = u.planStatus || "active";
  const end = Number(u.currentPeriodEnd) || 0; // ms epoch; 0 = no expiry (e.g. admin-granted)
  if (status === "active") return !end || now < end + GRACE_DAYS.renewal * DAY ? plan : "free";
  if (status === "canceled") return end && now < end ? plan : "free";
  if (status === "past_due") return end && now < end + GRACE_DAYS.pastDue * DAY ? plan : "free";
  return "free";
}

/** Flat entitlement object, e.g. { plan, dynamicQrs, staticQrs, monthlyScans, password, deviceTargeting, bulk } */
export function entitlementsFor(u, now = Date.now()) {
  const id = effectivePlanId(u, now);
  const p = PLANS[id] || PLANS.free;
  return { plan: id, isAdmin: id === "admin", ...p.limits, ...p.features };
}

export const formatPrice = (n) => `${CURRENCY.symbol}${Number(n).toLocaleString("en-IN")}`;
