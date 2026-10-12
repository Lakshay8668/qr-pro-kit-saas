// api/_lib/quota.js — monthly scan quota, enforced on every scan in api/_lib/handler.js.
//
// usage/{ownerId}_{yyyymm}  { uid, month, scans }      (server-only; no client access in firestore.rules)
// The month rolls over at 00:00 UTC on the 1st.
//
// Fails OPEN: if Firestore hiccups we would rather let a scan through than break a printed QR.

import { entitlementsFor } from "../../shared/plans.js";
import { isAdminUid } from "./adminAuth.js";

export const monthKey = (t) => new Date(t).toISOString().slice(0, 7).replace("-", "");
export const usageId = (uid, t) => `${uid}_${monthKey(t)}`;

/** { dynamicQrs, staticQrs } currently owned. Legacy v5 links have no `kind` and count as dynamic. */
export async function countLinks(db, uid) {
  const base = db.collection("links").where("ownerId", "==", uid);
  const [all, st] = await Promise.all([base.count().get(), base.where("kind", "==", "static").count().get()]);
  const staticQrs = st.data().count;
  return { dynamicQrs: all.data().count - staticQrs, staticQrs };
}

export function createQuota({ getDb, increment, serverTs, now = () => Date.now() }) {
  return {
    async check(ownerId) {
      if (isAdminUid(ownerId)) {
        return { ok: true, used: 0, limit: Infinity, plan: "admin", isAdmin: true };
      }
      try {
        const db = getDb();
        const t = now();
        const [u, use] = await Promise.all([
          db.collection("users").doc(ownerId).get(),
          db.collection("usage").doc(usageId(ownerId, t)).get(),
        ]);
        const ent = entitlementsFor(u.exists ? u.data() : {}, t);
        const used = use.exists ? Number(use.data().scans) || 0 : 0;
        return { ok: used < ent.monthlyScans, used, limit: ent.monthlyScans, plan: ent.plan };
      } catch (e) {
        console.error("quota check failed (allowing scan)", e);
        return { ok: true, used: 0, limit: Infinity, plan: "unknown" };
      }
    },
    async record(ownerId) {
      const t = now();
      await getDb()
        .collection("usage")
        .doc(usageId(ownerId, t))
        .set({ uid: ownerId, month: monthKey(t), scans: increment(1), updatedAt: serverTs() }, { merge: true });
    },
  };
}
