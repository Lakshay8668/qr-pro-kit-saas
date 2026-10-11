// src/lib/useBilling.js — the signed-in customer's plan, limits and live usage (GET /api/billing?action=me).
// One shared store, so Topbar / Dashboard / Billing don't each fire their own request.
import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
import { PLANS, entitlementsFor } from "../../shared/plans";

export function getDefaultBilling(user) {
  const ent = entitlementsFor(user || {});
  return {
    plan: ent.plan || "free",
    rawPlan: "free",
    status: "active",
    interval: null,
    currentPeriodEnd: 0,
    cancelAtPeriodEnd: false,
    provider: null,
    source: null,
    limits: { ...PLANS.free.limits, ...(PLANS[ent.plan]?.limits || {}) },
    features: { ...PLANS.free.features, ...(PLANS[ent.plan]?.features || {}) },
    usage: { dynamicQrs: 0, staticQrs: 0, monthlyScans: 0, month: "" },
    canManage: false,
    canCancel: false,
    isDefaultFallback: true,
  };
}

let state = { uid: null, me: null, loading: false, error: null };
const subs = new Set();
const set = (patch) => {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
};
let inflight = null;

export async function refreshBilling() {
  if (!state.uid) return null;
  const uid = state.uid;
  set({ loading: true });
  inflight = api("/api/billing?action=me")
    .then((rawMe) => {
      if (rawMe && typeof rawMe === "object" && !rawMe.error) {
        const planKey = rawMe.plan && PLANS[rawMe.plan] ? rawMe.plan : "free";
        const validatedMe = {
          plan: planKey,
          rawPlan: rawMe.rawPlan || planKey,
          status: rawMe.status || "active",
          interval: rawMe.interval || null,
          currentPeriodEnd: Number(rawMe.currentPeriodEnd) || 0,
          cancelAtPeriodEnd: !!rawMe.cancelAtPeriodEnd,
          provider: rawMe.provider || null,
          source: rawMe.source || null,
          limits: { ...PLANS[planKey].limits, ...(rawMe.limits || {}) },
          features: { ...PLANS[planKey].features, ...(rawMe.features || {}) },
          usage: { dynamicQrs: 0, staticQrs: 0, monthlyScans: 0, ...(rawMe.usage || {}) },
          canManage: !!rawMe.canManage,
          canCancel: !!rawMe.canCancel,
          isDefaultFallback: false,
        };
        if (state.uid === uid) set({ me: validatedMe, loading: false, error: null });
        return validatedMe;
      }
      throw new Error(rawMe?.message || "Invalid billing data received from server.");
    })
    .catch((e) => {
      if (state.uid === uid) {
        // Fallback to safe default billing so features and limits are never undefined
        set({
          me: state.me || getDefaultBilling({ uid }),
          loading: false,
          error: e?.message || "Could not fetch subscription details.",
        });
      }
      return null;
    });
  return inflight;
}

export function useBilling(user) {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state
  );
  const uid = user?.uid || null;

  useEffect(() => {
    if (uid && state.uid !== uid) {
      state = { uid, me: getDefaultBilling(user), loading: false, error: null };
      refreshBilling();
    }
    if (!uid && state.uid) {
      set({ uid: null, me: null, loading: false, error: null });
    }
  }, [uid, user]);

  return { me: s.me, loading: s.loading, error: s.error, refresh: refreshBilling };
}
