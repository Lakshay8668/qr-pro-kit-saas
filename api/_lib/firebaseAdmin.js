// api/_lib/firebaseAdmin.js — one place that initialises the Admin SDK for every function.
import crypto from "node:crypto";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

let _sa;
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

let _db;
export function getDb() {
  if (_db) return _db;
  init();
  _db = getFirestore();
  return _db;
}

export const adminAuth = () => {
  init();
  return getAuth();
};

export const increment = (n) => FieldValue.increment(n);
export const serverTs = () => FieldValue.serverTimestamp();

// Cookie-signing secret: explicit COOKIE_SECRET, else derived from the service-account key.
export const cookieSecret = () =>
  process.env.COOKIE_SECRET || crypto.createHash("sha256").update(loadServiceAccount().private_key || "qrpro").digest("hex");
