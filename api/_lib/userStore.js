// api/_lib/userStore.js — Persistent Customer Record Manager
// Guarantees that every authenticated Firebase user has a durable, persistent
// profile record in the database, linked to their stable Firebase UID.

import { entitlementsFor } from "../../shared/plans.js";

/**
 * Ensures that a customer record exists in db.collection("users") for the authenticated user.
 * Preserves existing subscription state, entitlements, and fields.
 */
export async function ensureUser(db, me, serverTs, extra = {}) {
  if (!me?.uid) return null;
  const ref = db.collection("users").doc(me.uid);
  const snap = await ref.get();

  if (!snap.exists) {
    const email = me.email || extra.email || "";
    const displayName = me.displayName || me.name || extra.displayName || "";
    const now = Date.now();
    const newUser = {
      uid: me.uid,
      email,
      displayName,
      plan: "free",
      planStatus: "active",
      planInterval: null,
      planSource: null,
      currentPeriodEnd: 0,
      cancelAtPeriodEnd: false,
      disabled: false,
      createdAt: serverTs ? serverTs() : new Date(now),
      ent: entitlementsFor({ plan: "free", planStatus: "active" }, now),
    };
    await ref.set(newUser);
    return newUser;
  }

  const cur = snap.data();
  const patch = {};
  const email = me.email || extra.email;
  const displayName = me.displayName || me.name || extra.displayName;

  if (!cur.email && email) patch.email = email;
  if (!cur.displayName && displayName) patch.displayName = displayName;

  if (Object.keys(patch).length > 0) {
    await ref.set(patch, { merge: true });
    return { ...cur, ...patch };
  }

  return cur;
}
