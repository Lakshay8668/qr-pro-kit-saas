// api/_lib/subscriptions.js — turns provider webhook events into the user's plan state.
//
// users/{uid} gets (server-written only — firestore.rules stop clients touching these):
//   plan: "free"|"pro"|"business"     planStatus: "active"|"past_due"|"canceled"
//   planInterval, currentPeriodEnd (ms), cancelAtPeriodEnd, planSource: "stripe"|"razorpay"|"admin"
//   billing: { provider, customerId, subscriptionId, lastEventTs }
//   ent: flat entitlements snapshot (firestore.rules read this to gate password / per-OS redirects)
// billingEvents/{provider_eventId}: dedupe record so retried webhooks are harmless.

import crypto from "node:crypto";
import { entitlementsFor } from "../../shared/plans.js";
import { lookupPlanByProviderId } from "./providers.js";
import { sendSubscriptionSuccessEmail } from "./email.js";

const STRIPE_STATUS = { active: "active", trialing: "active", past_due: "past_due", unpaid: "past_due", canceled: "canceled", incomplete_expired: "canceled" };
const RAZORPAY_STATUS = { active: "active", pending: "past_due", halted: "canceled", cancelled: "canceled", completed: "canceled", expired: "canceled", paused: "canceled" };

/** Atomically (a) record the event id, (b) ignore it if seen/stale, (c) write the new plan state. */
export async function applyState({ db, uid, state, eventKey, eventTs, now = () => Date.now(), serverTs }) {
  let recipientEmail = "";
  let recipientName = "";
  const result = await db.runTransaction(async (tx) => {
    const evRef = db.collection("billingEvents").doc(eventKey);
    const userRef = db.collection("users").doc(uid);
    const [ev, us] = await Promise.all([tx.get(evRef), tx.get(userRef)]);
    if (ev.exists) return "duplicate";
    const cur = us.exists ? us.data() : {};
    recipientEmail = cur.email || "";
    recipientName = cur.name || cur.displayName || "Valued Customer";
    tx.set(evRef, {
      uid,
      ts: serverTs ? serverTs() : now(),
      provider: state.planSource || null,
      plan: state.plan || null,
      interval: state.planInterval || null,
      subscriptionId: state.billing?.subscriptionId || null,
      paymentId: state.billing?.paymentId || null,
      status: state.planStatus || "active",
    });

    const curBilling = cur.billing || {};
    if (eventTs && curBilling.lastEventTs && eventTs < curBilling.lastEventTs) return "stale";
    // a late "canceled" for an OLD subscription must not wipe a newer one
    if (state.planStatus === "canceled" && curBilling.subscriptionId && state.billing?.subscriptionId && curBilling.subscriptionId !== state.billing.subscriptionId) {
      return "other_subscription";
    }
    const next = {
      ...state,
      billing: { ...curBilling, ...(state.billing || {}), lastEventTs: eventTs || curBilling.lastEventTs || 0 },
    };
    next.ent = entitlementsFor({ ...cur, ...next }, now());
    tx.set(userRef, next, { merge: true });
    return "applied";
  });

  if (result === "applied" && state.planStatus === "active" && recipientEmail) {
    sendSubscriptionSuccessEmail({
      toEmail: recipientEmail,
      customerName: recipientName,
      planName: state.plan,
      interval: state.planInterval || "monthly",
      provider: state.planSource === "stripe" ? "Stripe" : "Razorpay",
      subscriptionId: state.billing?.subscriptionId,
    }).catch((e) => console.warn("[Email Notification] Async dispatch warning:", e.message));
  }

  return result;
}

/** Find the uid for a Stripe customer when an event carries no metadata. */
async function uidByCustomer(db, customerId) {
  if (!customerId) return null;
  const snap = await db.collection("users").where("billing.customerId", "==", customerId).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

/** Find the uid for a Razorpay subscription when an event carries no notes. */
async function uidBySubscription(db, subscriptionId) {
  if (!subscriptionId) return null;
  const snap = await db.collection("users").where("billing.subscriptionId", "==", subscriptionId).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

export function stripeStateFromSub(sub, env) {
  const status = STRIPE_STATUS[sub.status];
  if (!status) return null; // incomplete etc. -> wait for the next event
  const priceId = sub.items?.data?.[0]?.price?.id;
  const found = lookupPlanByProviderId("stripe", priceId, env);
  const plan = found?.plan || sub.metadata?.plan;
  if (plan !== "pro" && plan !== "business") return null;
  const end = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end; // newer API versions moved it onto the item
  return {
    plan,
    planStatus: status,
    planInterval: found?.interval || sub.metadata?.interval || null,
    currentPeriodEnd: end ? end * 1000 : 0,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    planSource: "stripe",
    billing: { provider: "stripe", customerId: String(sub.customer || ""), subscriptionId: sub.id },
  };
}

export function razorpayStateFromSub(sub, env) {
  const status = RAZORPAY_STATUS[sub.status];
  if (!status) return null; // created / authenticated: no money yet
  const found = lookupPlanByProviderId("razorpay", sub.plan_id, env);
  const plan = found?.plan || sub.notes?.plan;
  if (plan !== "pro" && plan !== "business") return null;
  const interval = found?.interval || sub.notes?.interval || "monthly";
  let endSec = sub.current_end || sub.charge_at || sub.end_at;
  if (!endSec && status === "active") {
    endSec = Math.floor(Date.now() / 1000) + (interval === "yearly" ? 365 : 30) * 86400;
  }
  return {
    plan,
    planStatus: status,
    planInterval: interval,
    currentPeriodEnd: endSec ? endSec * 1000 : 0,
    cancelAtPeriodEnd: sub.has_scheduled_changes === true || (status === "canceled" && !!endSec),
    planSource: "razorpay",
    billing: { provider: "razorpay", customerId: String(sub.customer_id || ""), subscriptionId: sub.id },
  };
}

export function createSubscriptionHandlers({ getDb, env, stripe, now = () => Date.now(), serverTs }) {
  const db = () => getDb();

  async function stripeEvent(event) {
    const o = event.data?.object || {};
    const key = `stripe_${event.id}`;
    let sub = null;
    let uid = null;
    if (event.type === "checkout.session.completed") {
      if (o.mode !== "subscription" || !o.subscription) return "ignored";
      uid = o.client_reference_id || o.metadata?.uid;
      sub = await stripe().getSubscription(o.subscription); // fetch the full, current state — don't wait for a separate event
      sub.metadata = { ...(sub.metadata || {}), ...(o.metadata || {}) };
    } else if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
      sub = o;
      uid = sub.metadata?.uid || (await uidByCustomer(db(), sub.customer));
    } else {
      return "ignored";
    }
    if (!uid) return "no_user";
    const state = stripeStateFromSub(sub, env);
    if (!state) return "ignored";
    return applyState({ db: db(), uid, state, eventKey: key, eventTs: event.created, now, serverTs });
  }

  async function razorpayEvent(body, eventId) {
    const ev = String(body.event || "");
    if (!ev.startsWith("subscription.")) return "ignored";
    const sub = body.payload?.subscription?.entity;
    if (!sub) return "ignored";
    let uid = sub.notes?.uid;
    if (!uid) {
      uid = await uidBySubscription(db(), sub.id);
    }
    if (!uid) return "no_user";
    const state = razorpayStateFromSub(sub, env);
    if (!state) return "ignored";
    return applyState({ db: db(), uid, state, eventKey: `razorpay_${eventId}`, eventTs: body.created_at, now, serverTs });
  }

  const eventIdFor = (raw, headerId) => headerId || crypto.createHash("sha256").update(raw).digest("hex").slice(0, 40);
  return { stripeEvent, razorpayEvent, eventIdFor };
}
