// src/lib/users.js — creates the customer's profile doc on first login (used by the admin dashboard).
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, getFirestoreStatus, setFirestoreUnavailable, setFirestoreAvailable } from "./firebase";
import { api } from "./api";

const done = new Set();

export async function ensureUserDoc(user) {
  if (!user || done.has(user.uid)) return;
  done.add(user.uid);

  // 1. Sync with backend persistent database
  try {
    await api("/api/users?action=sync", {
      method: "POST",
      body: {
        email: user.email || "",
        displayName: user.displayName || "",
      },
    });
  } catch (err) {
    // Non-fatal if offline or during initial startup
    console.debug("[Users] Backend user sync note:", err.message);
  }

  // 2. Fallback to client Firestore if available
  if (!db || getFirestoreStatus().available === false) return;

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
    } else {
      done.delete(user.uid); // retry next time on transient errors
    }
  }
}
