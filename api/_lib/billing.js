// api/_lib/billing.js — the customer-facing billing API behind /pricing and /billing.
//
// GET  ?action=config                      -> { providers: { stripe, razorpay } }      (public)
// GET  ?action=diagnose                    -> safe diagnostic report for gateways & plans
// GET  ?action=me                          -> plan, limits, usage, subscription state  (signed in)
// POST ?action=checkout {plan,interval,provider} -> { url, subscriptionId?, keyId? } redirect or popup
// POST ?action=verify-razorpay             -> verify payment signature and activate plan
// POST ?action=portal                      -> { url }         Stripe customer portal (change card / plan / invoices)
// POST ?action=cancel                      -> { ok }          cancel at the end of the paid period

import { PLANS, entitlementsFor, isPaidPlan, isInterval } from "../../shared/plans.js";
import {
  planEnvKey,
  cleanPlanId,
  maskPlanId,
  getSafeCredentialFingerprint,
  getRazorpayCredentials,
  getRazorpayPlanEnvConfig,
  verifySubscriptionPaymentSignature,
} from "./providers.js";
import { countLinks, monthKey, usageId } from "./quota.js";
import { ensureUser } from "./userStore.js";
import { applyState } from "./subscriptions.js";

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
};

export const providersEnabled = (env) => {
  const creds = getRazorpayCredentials(env);
  return {
    stripe: !!env.STRIPE_SECRET_KEY,
    razorpay: !!(creds.keyId && creds.keySecret),
  };
};

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

      // ------------------------------------------------------------------ public config
      if (req.method === "GET" && action === "config") {
        return json(res, 200, { providers: providersEnabled(env()) });
      }

      // ------------------------------------------------------------------ safe diagnostic report
      if (req.method === "GET" && action === "diagnose") {
        const e = env();
        const creds = getRazorpayCredentials(e);
        const stripeConfigured = !!e.STRIPE_SECRET_KEY;
        const rzpConfigured = !!(creds.keyId && creds.keySecret);

        // Scan all env vars in Railway runtime matching RAZORPAY or RZP
        const detectedVars = Object.keys(e)
          .filter((k) => /^(RAZORPAY|RZP|VITE_RAZORPAY)/i.test(k))
          .sort()
          .map((k) => {
            const val = cleanPlanId(e[k]);
            const isSecret = /secret/i.test(k);
            return {
              name: k,
              isSet: !!val,
              length: val ? val.length : 0,
              preview: isSecret ? "(masked secret)" : maskPlanId(val),
              fingerprint: getSafeCredentialFingerprint(val),
              mode: val.startsWith("rzp_test_")
                ? "test"
                : val.startsWith("rzp_live_")
                ? "live"
                : val.startsWith("plan_")
                ? "plan"
                : isSecret
                ? "secret"
                : "unknown",
            };
          });

        const diag = {
          timestamp: new Date().toISOString(),
          server: {
            nodeVersion: process.version,
            uptimeSeconds: Math.round(process.uptime()),
          },
          providers: {
            stripe: stripeConfigured,
            razorpay: rzpConfigured,
          },
          razorpay: {
            configured: rzpConfigured,
            keyIdPreview: maskPlanId(creds.keyId),
            keyMode: creds.keyMode,
            keySecretConfigured: !!creds.keySecret,
            webhookSecretConfigured: !!creds.webhookSecret,
            activeCredentials: {
              keyIdPreview: maskPlanId(creds.keyId),
              keyIdSourceVar: creds.keySourceVar,
              keyIdFingerprint: getSafeCredentialFingerprint(creds.keyId),
              keyMode: creds.keyMode,
              keySecretSourceVar: creds.secretSourceVar,
              keySecretConfigured: !!creds.keySecret,
              keySecretFingerprint: getSafeCredentialFingerprint(creds.keySecret),
              webhookSecretSourceVar: creds.webhookSecretSourceVar,
              webhookSecretConfigured: !!creds.webhookSecret,
              webhookSecretFingerprint: getSafeCredentialFingerprint(creds.webhookSecret),
            },
            environmentVariablesFound: detectedVars,
            authStatus: "unchecked",
            accountPlans: [],
            configuredPlans: {},
            recommendations: [],
          },
        };

        if (rzpConfigured) {
          const rzp = makeRazorpay(creds);
          try {
            const listRes = await rzp.listPlans(50);
            diag.razorpay.authStatus = "authenticated";
            diag.razorpay.accountPlans = (listRes?.items || []).map((p) => ({
              id: p.id,
              name: p.item?.name || "(unnamed)",
              amount: (p.item?.amount || 0) / 100,
              currency: p.item?.currency || "INR",
              period: p.period,
              interval: p.interval,
              active: p.item?.active !== false,
            }));
          } catch (authErr) {
            diag.razorpay.authStatus = `failed: ${authErr.message}`;
          }

          // Check each required plan configuration
          for (const plan of ["pro", "business"]) {
            for (const interval of ["monthly", "yearly"]) {
              const cfg = getRazorpayPlanEnvConfig(e, plan, interval);
              const targetAmount = PLANS[plan].price[interval];
              const planKey = `${plan}_${interval}`;

              const info = {
                envVar: cfg.key,
                configuredId: maskPlanId(cfg.value),
                isSet: !!cfg.value,
                valid: false,
                status: "not_checked",
                matchedAccountPlan: null,
              };

              if (cfg.value) {
                // Check if this ID exists in accountPlans
                const foundInList = diag.razorpay.accountPlans.find((p) => p.id === cfg.value);
                if (foundInList) {
                  info.valid = true;
                  info.status = "valid";
                  info.matchedAccountPlan = foundInList;
                } else if (diag.razorpay.authStatus === "authenticated") {
                  try {
                    const fetched = await rzp.getPlan(cfg.value);
                    info.valid = true;
                    info.status = "valid";
                    info.matchedAccountPlan = {
                      id: fetched.id,
                      name: fetched.item?.name,
                      amount: (fetched.item?.amount || 0) / 100,
                      period: fetched.period,
                    };
                  } catch (pErr) {
                    info.valid = false;
                    info.status = `invalid: ${pErr.message}`;
                  }
                }
              } else {
                info.status = "unset";
              }

              // Recommendation if invalid or unset
              if (!info.valid && diag.razorpay.accountPlans.length > 0) {
                const autoMatch = diag.razorpay.accountPlans.find(
                  (p) => p.period === interval && p.amount === targetAmount
                );
                if (autoMatch) {
                  diag.razorpay.recommendations.push(
                    `Found matching ${PLANS[plan].name} ${interval} plan in Razorpay (${autoMatch.id}, ₹${autoMatch.amount}/${autoMatch.period}). Set ${cfg.key}=${autoMatch.id} in Railway.`
                  );
                } else {
                  diag.razorpay.recommendations.push(
                    `No plan with amount ₹${targetAmount}/${interval} found in Razorpay account. Create a ${interval} plan for ₹${targetAmount} in Razorpay Dashboard and set ${cfg.key}.`
                  );
                }
              }

              diag.razorpay.configuredPlans[planKey] = info;
            }
          }
        }

        // Add high-level recommendations
        if (creds.keyMode === "live" && !creds.hasTestCredentials) {
          diag.razorpay.recommendations.unshift(
            `Railway is currently running with a LIVE Razorpay Key (${maskPlanId(creds.keyId)}). ` +
            `If you want to use Test Mode with Test Mode plans, set RAZORPAY_TEST_KEY_ID (or replace RAZORPAY_KEY_ID) with your rzp_test_... key and RAZORPAY_TEST_KEY_SECRET in Railway variables.`
          );
        } else if (creds.keyMode === "test") {
          diag.razorpay.recommendations.unshift(
            `Razorpay is running in TEST Mode using ${creds.keySourceVar} (${maskPlanId(creds.keyId)}). No real charges will be incurred.`
          );
        }

        return json(res, 200, diag);
      }

      // Authentication required for remaining endpoints
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
          const providerPlanId = cleanPlanId(e[planEnvKey("stripe", plan, interval)]);
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
        const creds = getRazorpayCredentials(e);
        const cfg = getRazorpayPlanEnvConfig(e, plan, interval);
        let providerPlanId = cfg.value;
        const rzp = makeRazorpay(creds);

        // 1. If not configured in env, attempt auto-discovery from user's live Razorpay account
        if (!providerPlanId) {
          try {
            const listRes = await rzp.listPlans(50).catch(() => null);
            const targetAmount = PLANS[plan].price[interval];
            const matchingPlan = (listRes?.items || []).find(
              (p) => p.period === interval && (p.item?.amount === targetAmount * 100 || (p.item?.name || "").toLowerCase().includes(plan))
            );
            if (matchingPlan) {
              console.log(`[Billing] Auto-discovered plan for ${plan} (${interval}) from account: ${matchingPlan.id}`);
              providerPlanId = cleanPlanId(matchingPlan.id);
            }
          } catch (discErr) {
            console.warn("[Billing] Plan discovery note:", discErr.message);
          }
        }

        // 2. If still not configured, check DB plan cache or attempt auto-creation
        if (!providerPlanId) {
          try {
            const planCacheRef = db.collection("config").doc("razorpay_plans");
            const planCacheDoc = await planCacheRef.get();
            const planCache = planCacheDoc.exists ? planCacheDoc.data() : {};
            const cacheKey = `${plan}_${interval}`;
            if (planCache[cacheKey]) {
              providerPlanId = cleanPlanId(planCache[cacheKey]);
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
              providerPlanId = cleanPlanId(createdPlan.id);
              await planCacheRef.set({ [cacheKey]: providerPlanId }, { merge: true });
            }
          } catch (planErr) {
            console.warn("[Billing] Auto-provisioning Razorpay plan note:", planErr.message);
          }
        }

        if (!providerPlanId) {
          return json(res, 503, {
            error: "not_configured",
            message: `${PLANS[plan].name} (${interval}) isn't set up yet. Set ${cfg.key} in Railway environment variables.`,
          });
        }

        // 3. Attempt subscription creation, with auto-recovery if configured planId is invalid
        let s = null;
        try {
          s = await rzp.createSubscription({ planId: providerPlanId, uid: me.uid, plan, interval });
        } catch (subErr) {
          console.warn(`[Billing] Initial subscription creation failed for planId "${maskPlanId(providerPlanId)}":`, subErr.message);

          // If Razorpay returns "The ID provided is invalid or could not be found", inspect the account to recover or give actionable diagnostic!
          if (
            subErr.message?.includes("invalid or could not be found") ||
            subErr.message?.includes("does not exist") ||
            subErr.status === 400
          ) {
            let accountPlansList = null;
            try {
              accountPlansList = await rzp.listPlans(50);
            } catch (listErr) {
              console.warn("[Billing] Could not fetch account plans list:", listErr.message);
            }

            const items = accountPlansList?.items || [];
            const targetAmount = PLANS[plan].price[interval];
            const candidate = items.find(
              (p) => p.period === interval && (p.item?.amount === targetAmount * 100 || (p.item?.name || "").toLowerCase().includes(plan))
            );

            if (candidate && candidate.id !== providerPlanId) {
              console.log(`[Billing] Auto-recovering: Found matching plan in Razorpay account: ${candidate.id}. Retrying subscription.`);
              try {
                s = await rzp.createSubscription({ planId: candidate.id, uid: me.uid, plan, interval });
                providerPlanId = candidate.id;
              } catch (retryErr) {
                console.error("[Billing] Retry subscription creation failed:", retryErr.message);
              }
            }

            if (!s) {
              const summary = items.length
                ? items.map((p) => `${p.id} (${p.item?.name || p.period} - ₹${(p.item?.amount || 0) / 100})`).join(", ")
                : "No plans found in this Razorpay account";

              const errMsg = `The configured Razorpay plan ID for ${PLANS[plan].name} (${interval}) is invalid. ` +
                `Railway variable ${cfg.key} has "${maskPlanId(providerPlanId)}", which was not found in your Razorpay account (${maskPlanId(creds.keyId)} [${creds.keyMode}]). ` +
                `Available plans in your account: [${summary}]. ` +
                `Please update ${cfg.key} in Railway to match your Razorpay plan ID.`;

              console.error("[Billing]", errMsg);
              return json(res, 400, {
                error: "invalid_plan_id",
                message: errMsg,
                configuredVar: cfg.key,
                configuredId: maskPlanId(providerPlanId),
                keyMode: creds.keyMode,
                keyIdPreview: maskPlanId(creds.keyId),
                availablePlans: items.map((p) => ({ id: p.id, name: p.item?.name, amount: (p.item?.amount || 0) / 100, period: p.period })),
              });
            }
          } else {
            throw subErr;
          }
        }

        const checkoutUrl = s.short_url || `https://rzp.io/i/${s.id}`;
        return json(res, 200, {
          url: checkoutUrl,
          subscriptionId: s.id,
          keyId: creds.keyId,
          plan,
          interval,
        });
      }

      // ------------------------------------------------------------------ verify-razorpay (client signature verification)
      if (action === "verify-razorpay") {
        const paymentId = cleanPlanId(body.razorpay_payment_id || "");
        const subscriptionId = cleanPlanId(body.razorpay_subscription_id || "");
        const signature = cleanPlanId(body.razorpay_signature || "");
        const plan = String(body.plan || "");
        const interval = String(body.interval || "monthly");

        if (!paymentId || !subscriptionId || !signature) {
          return json(res, 400, { error: "bad_request", message: "Missing payment verification parameters." });
        }

        const creds = getRazorpayCredentials(e);
        const secret = creds.keySecret;
        if (!secret) {
          return json(res, 500, { error: "not_configured", message: "Razorpay Key Secret is not configured." });
        }

        if (!verifySubscriptionPaymentSignature(paymentId, subscriptionId, signature, secret)) {
          return json(res, 400, { error: "invalid_signature", message: "Payment signature verification failed." });
        }

        const targetPlan = isPaidPlan(plan) ? plan : "pro";
        let subDetails = null;
        try {
          subDetails = await makeRazorpay(creds).getSubscription(subscriptionId);
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
