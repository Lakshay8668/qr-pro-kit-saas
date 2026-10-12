// api/_lib/firebaseAdmin.js — Resilient database & admin provider.
// Automatically delegates to universal persistent db adapter when service account is not present.

import crypto from "node:crypto";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import {
  getDb as getUniversalDb,
  serverTs as universalServerTs,
  increment as universalIncrement,
  cookieSecret as universalCookieSecret,
} from "./db.js";

let _sa = null;
export function loadServiceAccount() {
  if (_sa) return _sa;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || "";
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT env var is missing");
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const sa = JSON.parse(text);
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  _sa = sa;
  return sa;
}

function init() {
  if (!getApps().length) initializeApp({ credential: cert(loadServiceAccount()) });
}

let _db = null;
export function getDb() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      if (_db) return _db;
      init();
      _db = getFirestore();
      return _db;
    } catch (e) {
      console.warn("[FirebaseAdmin] Failed initializing Firestore, using universal database:", e.message);
    }
  }
  return getUniversalDb();
}

export const adminAuth = () => {
  init();
  return getAuth();
};

export const increment = (n) => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      return FieldValue.increment(n);
    } catch {}
  }
  return universalIncrement(n);
};

export const serverTs = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      return FieldValue.serverTimestamp();
    } catch {}
  }
  return universalServerTs();
};

export const cookieSecret = () => {
  if (process.env.COOKIE_SECRET) return process.env.COOKIE_SECRET;
  try {
    const sa = loadServiceAccount();
    if (sa?.private_key) {
      return crypto.createHash("sha256").update(sa.private_key).digest("hex");
    }
  } catch {}
  return universalCookieSecret();
};
