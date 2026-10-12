// src/lib/users.js — creates the customer's profile doc on first login (used by the admin dashboard).
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, getFirestoreStatus, setFirestoreUnavailable, setFirestoreAvailable } from "./firebase";

const done = new Set();

export async function ensureUserDoc(user) {
  if (!user || done.has(user.uid)) return;
  if (!db || getFirestoreStatus().available === false) return; // Don't query nonexistent database

  done.add(user.uid);
  try {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    setFirestoreAvailable();
    if (!snap.exists()) {
      await setDoc(ref, {
        email: user.email || "",
        displayName: user.displayName || "",
        createdAt: serverTimestamp(),
        disabled: false,
      });
    }
  } catch (err) {
    const msg = err?.message || "";
    const code = err?.code || "";
    if (
      code === "not-found" ||
      code === "failed-precondition" ||
      code === "unavailable" ||
      msg.includes("not found") ||
      msg.includes("does not exist") ||
      msg.includes("(default)")
    ) {
      setFirestoreUnavailable(err);
      console.warn("Cloud Firestore is not available for user profiles:", err.message);
      // Keep user.uid in done so we don't spam the console on every state change
    } else {
      done.delete(user.uid); // retry next time on transient errors
    }
  }
}
