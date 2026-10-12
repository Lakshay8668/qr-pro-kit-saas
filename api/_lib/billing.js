// api/_lib/billing.js — the customer-facing billing API behind /pricing and /billing.
//
// GET  ?action=config                      -> { providers: { stripe, razorpay } }      (public)
// GET  ?action=me                          -> plan, limits, usage, subscription state  (signed in)
// POST ?action=checkout {plan,interval,provider} -> { url, subscriptionId?, keyId? } redirect or popup
// POST ?action=verify-razorpay             -> verify payment signature and activate plan
// POST ?action=portal                      -> { url }         Stripe customer portal (change card / plan / invoices)
// POST ?action=cancel                      -> { ok }          cancel at the end of the paid period

import { PLANS, entitlementsFor, isPaidPlan, isInterval } from "../../shared/plans.js";
import { planEnvKey, verifySubscriptionPaymentSignature } from "./providers.js";
import { countLinks, monthKey, usageId } from "./quota.js";
import { ensureUser } from "./userStore.js";
import { applyState } from "./subscriptions.js";

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
};

export const providersEnabled = (env) => ({
  stripe: !!env.STRIPE_SECRET_KEY,
  razorpay: !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
});

export function createBillingHandler({ getDb, verify, env, makeStripe, makeRazorpay, now = () => Date.now(), serverTs }) {
  const originOf = (req) => {
    const e = env();
    if (e.APP_URL) return e.APP_URL.replace(/\/+$/, "");
    const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
    const proto = req.headers["x-forwarded-proto"] || (String(host).startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  };

  return async function handler(req, res) {
    try {
      const action = String(req.query?.action || "");

      if (req.method === "GET" && action === "config") return json(res, 200, { providers: providersEnabled(env()) });

      const token = String(req.headers.authorization || req.headers.Authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { error: "sign_in_required", message: "Please sign in first." });
      let me;
      try {
        me = await verify(token);
      } catch {
        return json(res, 401, { error: "bad_token", message: "Your session expired — sign in again." });
      }

      const db = getDb();
      const user = (await ensureUser(db, me, serverTs)) || {};
      const uRef = db.collection("users").doc(me.uid);
      const t = now();
      const ent = entitlementsFor(user, t);
      const billing = user.billing || {};

      // ------------------------------------------------------------------ me
      if (req.method === "GET" && action === "me") {
        const [used, usage] = await Promise.all([countLinks(db, me.uid), db.collection("usage").doc(usageId(me.uid, t)).get()]);
        const fromAdmin = user.planSource === "admin";
        return json(res, 200, {
          plan: ent.plan,
          rawPlan: user.plan || "free",
          status: user.planStatus || "active",
          interval: user.planInterval || null,
          currentPeriodEnd: Number(user.currentPeriodEnd) || 0,
          cancelAtPeriodEnd: !!user.cancelAtPeriodEnd,
          provider: billing.provider || null,
          source: user.planSource || null,
          limits: { dynamicQrs: ent.dynamicQrs, staticQrs: ent.staticQrs, monthlyScans: ent.monthlyScans },
          features: { password: ent.password, deviceTargeting: ent.deviceTargeting, bulk: ent.bulk },
          usage: { ...used, monthlyScans: usage.exists ? Number(usage.data().scans) || 0 : 0, month: monthKey(t) },
          canManage: billing.provider === "stripe" && !!billing.customerId,
          canCancel: !!billing.subscriptionId && !fromAdmin && user.planStatus === "active" && !user.cancelAtPeriodEnd && ent.plan !== "free",
        });
      }

      if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const e = env();

      // ------------------------------------------------------------------ checkout
      if (action === "checkout") {
        const plan = String(body.plan || "");
        const interval = String(body.interval || "monthly");
        const provider = String(body.provider || "");
        if (!isPaidPlan(plan) || !isInterval(interval)) return json(res, 400, { error: "bad_request", message: "Pick a paid plan and billing interval." });
        if (!providersEnabled(e)[provider]) {
          const provName = provider === "razorpay" ? "Razorpay" : "Stripe";
          return json(res, 400, {
            error: "provider_unavailable",
            message: `${provName} is not configured yet. Configure API credentials in server environment variables to enable checkout.`,
          });
        }
        if (user.disabled) return json(res, 403, { error: "account_disabled", message: "This account has been disabled." });
        if (ent.plan !== "free" && user.planSource !== "admin" && user.planStatus === "active" && !user.cancelAtPeriodEnd && billing.subscriptionId) {
          return json(res, 409, {
            error: "already_subscribed",
            portal: billing.provider === "stripe",
            message:
              billing.provider === "stripe"
                ? "You already have an active subscription — use “Manage billing” to change plan."
                : "You already have an active subscription. Cancel it first (it stays active until the period ends), then pick a new plan.",
          });
        }

        const base = originOf(req);
        if (provider === "stripe") {
          const providerPlanId = e[planEnvKey("stripe", plan, interval)];
          if (!providerPlanId) {
            return json(res, 503, { error: "not_configured", message: `Stripe ${PLANS[plan].name} (${interval}) price is not set up.` });
          }
          const s = await makeStripe().createCheckout({
            priceId: providerPlanId, uid: me.uid, email: me.email, plan, interval,
            customerId: billing.provider === "stripe" ? billing.customerId : undefined,
            successUrl: `${base}/billing?checkout=success`, cancelUrl: `${base}/pricing?checkout=cancel`,
          });
          return json(res, 200, { url: s.url });
        }

        // Razorpay checkout
        let providerPlanId = e[planEnvKey("razorpay", plan, interval)];
        const rzp = makeRazorpay();

        // If RAZORPAY_PLAN_* is not explicitly set, auto-provision or load cached plan from DB
        if (!providerPlanId) {
          try {
            const planCacheRef = db.collection("config").doc("razorpay_plans");
            const planCacheDoc = await planCacheRef.get();
            const planCache = planCacheDoc.exists ? planCacheDoc.data() : {};
            const cacheKey = `${plan}_${interval}`;
            if (planCache[cacheKey]) {
              providerPlanId = planCache[cacheKey];
            } else {
              const amountPaise = (PLANS[plan].price[interval] || 0) * 100;
              const createdPlan = await rzp.createPlan({
                period: interval === "yearly" ? "yearly" : "monthly",
                interval: 1,
                name: `QR Pro Kit ${PLANS[plan].name} (${interval})`,
                amount: amountPaise,
                currency: "INR",
                description: `${PLANS[plan].name} Plan Subscription`,
              });
              providerPlanId = createdPlan.id;
              await planCacheRef.set({ [cacheKey]: providerPlanId }, { merge: true });
            }
          } catch (planErr) {
            console.warn("[Billing] Auto-provisioning Razorpay plan note:", planErr.message);
          }
        }

        if (!providerPlanId) {
          return json(res, 503, {
            error: "not_configured",
            message: `${PLANS[plan].name} (${interval}) isn't set up yet. Set ${planEnvKey("razorpay", plan, interval)} in environment variables.`,
          });
        }

        const s = await rzp.createSubscription({ planId: providerPlanId, uid: me.uid, plan, interval });
        const checkoutUrl = s.short_url || `https://rzp.io/i/${s.id}`;
        return json(res, 200, {
          url: checkoutUrl,
          subscriptionId: s.id,
          keyId: e.RAZORPAY_KEY_ID,
          plan,
          interval,
        });
      }

      // ------------------------------------------------------------------ verify-razorpay (client signature verification)
      if (action === "verify-razorpay") {
        const paymentId = String(body.razorpay_payment_id || "");
        const subscriptionId = String(body.razorpay_subscription_id || "");
        const signature = String(body.razorpay_signature || "");
        const plan = String(body.plan || "");
        const interval = String(body.interval || "monthly");

        if (!paymentId || !subscriptionId || !signature) {
          return json(res, 400, { error: "bad_request", message: "Missing payment verification parameters." });
        }

        const secret = e.RAZORPAY_KEY_SECRET;
        if (!secret) {
          return json(res, 500, { error: "not_configured", message: "RAZORPAY_KEY_SECRET is not configured." });
        }

        if (!verifySubscriptionPaymentSignature(paymentId, subscriptionId, signature, secret)) {
          return json(res, 400, { error: "invalid_signature", message: "Payment signature verification failed." });
        }

        const targetPlan = isPaidPlan(plan) ? plan : "pro";
        let subDetails = null;
        try {
          subDetails = await makeRazorpay().getSubscription(subscriptionId);
        } catch (subErr) {
          console.warn("[Billing] Could not fetch subscription from Razorpay:", subErr.message);
        }

        const endSec = subDetails?.current_end || subDetails?.charge_at || (Math.floor(Date.now() / 1000) + (interval === "yearly" ? 365 : 30) * 86400);
        const state = {
          plan: targetPlan,
          planStatus: "active",
          planInterval: interval,
          currentPeriodEnd: endSec * 1000,
          cancelAtPeriodEnd: false,
          planSource: "razorpay",
          billing: {
            provider: "razorpay",
            customerId: String(subDetails?.customer_id || ""),
            subscriptionId,
            paymentId,
          },
        };

        const result = await applyState({
          db,
          uid: me.uid,
          state,
          eventKey: `rzp_verify_${subscriptionId}_${paymentId}`,
          eventTs: Math.floor(Date.now() / 1000),
          now,
          serverTs,
        });

        return json(res, 200, { ok: true, result, plan: targetPlan, status: "active" });
      }

      // ------------------------------------------------------------------ portal (Stripe)
      if (action === "portal") {
        if (billing.provider !== "stripe" || !billing.customerId) return json(res, 400, { error: "no_portal", message: "There's no card-billing portal for this account." });
        const s = await makeStripe().createPortal({ customerId: billing.customerId, returnUrl: `${originOf(req)}/billing` });
        return json(res, 200, { url: s.url });
      }

      // ------------------------------------------------------------------ cancel at period end
      if (action === "cancel") {
        if (!billing.subscriptionId || user.planSource === "admin") return json(res, 400, { error: "nothing_to_cancel", message: "There's no active subscription to cancel." });
        try {
          if (billing.provider === "stripe") await makeStripe().setCancelAtPeriodEnd(billing.subscriptionId, true);
          else await makeRazorpay().cancelAtCycleEnd(billing.subscriptionId);
        } catch (err) {
          console.error("cancel failed", err);
          return json(res, 502, { error: "provider_error", message: "The payment provider couldn't cancel this right now. Please try again." });
        }
        await uRef.set({ cancelAtPeriodEnd: true }, { merge: true }); // webhook will confirm
        return json(res, 200, { ok: true });
      }

      return json(res, 400, { error: "unknown_action" });
    } catch (err) {
      console.error("billing api error", err);
      return json(res, 500, { error: "server_error", message: err.message || "Something went wrong. Please try again." });
    }
  };
}
