// src/lib/firebase.js
// Initializes Firebase once and exports the pieces the app needs.
// Gracefully handles missing services (e.g. Starter tier projects without Firestore/Storage).

import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Resolve configuration: prefer runtime injected window.__APP_CONFIG__ (from Railway server), fallback to Vite build-time env
const runtimeConfig = (typeof window !== "undefined" && window.__APP_CONFIG__) || {};

export const firebaseConfig = {
  apiKey: runtimeConfig.apiKey || import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: runtimeConfig.authDomain || import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: runtimeConfig.projectId || import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: runtimeConfig.storageBucket || import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: runtimeConfig.messagingSenderId || import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: runtimeConfig.appId || import.meta.env.VITE_FIREBASE_APP_ID || "",
};

export function isValidApiKey(key) {
  if (!key || typeof key !== "string") return false;
  const trimmed = key.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") return false;
  if (trimmed.includes("your_") || trimmed.includes("your-api-key")) return false;
  return trimmed.length >= 10;
}

// Check if credentials appear configured (not placeholder / not empty)
export const isFirebaseConfigured = Boolean(
  isValidApiKey(firebaseConfig.apiKey) &&
  firebaseConfig.projectId &&
  !firebaseConfig.projectId.includes("your_") &&
  !firebaseConfig.projectId.includes("your-project-id")
);

let app = null;
let auth = null;
let db = null;
let initError = null;

if (isFirebaseConfigured) {
  try {
    app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (err) {
    console.warn("[Firebase] Could not initialize Firebase services:", err.message);
    initError = err.message;
    app = null;
    auth = null;
    db = null;
  }
} else {
  console.info(
    "[Firebase] Client credentials are not configured or are incomplete. " +
    "Public features (static QR creation, pricing comparison, styling) remain active. " +
    "To enable user accounts and dashboard sync, configure VITE_FIREBASE_API_KEY and VITE_FIREBASE_PROJECT_ID."
  );
}

export { app, auth, db, initError };

// Lazy storage instance — does NOT initialize or import firebase/storage on app load
let _storage = null;
export async function getStorageInstance() {
  if (!app) {
    throw new Error("Firebase is not configured. Please provide Firebase credentials to use Cloud Storage.");
  }
  if (!isStorageConfigured()) {
    throw new Error(
      `Firebase Cloud Storage is not enabled for project "${firebaseConfig.projectId || "delta-abbey-4f38q"}". ` +
      `To host file uploads, enable Cloud Storage in Firebase Console (Build → Storage) and set VITE_FIREBASE_STORAGE_ENABLED=true.`
    );
  }
  if (!_storage) {
    const { getStorage } = await import("firebase/storage");
    _storage = getStorage(app);
  }
  return _storage;
}

// Deprecated direct export kept as null for backwards compatibility
export const storage = null;

// Service availability tracker to prevent repeated failed queries / reconnect loops
let firestoreState = {
  tested: false,
  available: true, // assume available until proven otherwise
  error: null,
};

const firestoreListeners = new Set();

export function getFirestoreStatus() {
  return firestoreState;
}

export function subscribeFirestoreStatus(callback) {
  firestoreListeners.add(callback);
  return () => firestoreListeners.delete(callback);
}

export function setFirestoreUnavailable(err) {
  const errMsg = err?.message || String(err || "Database not available");
  firestoreState = {
    tested: true,
    available: false,
    error: errMsg,
  };
  firestoreListeners.forEach((fn) => {
    try {
      fn(firestoreState);
    } catch {
      // ignore
    }
  });
}

export function setFirestoreAvailable() {
  if (firestoreState.available && firestoreState.tested) return;
  firestoreState = {
    tested: true,
    available: true,
    error: null,
  };
  firestoreListeners.forEach((fn) => {
    try {
      fn(firestoreState);
    } catch {
      // ignore
    }
  });
}

export function isStorageConfigured() {
  // Cloud Storage is not available on Firebase Starter tier projects unless explicitly enabled
  // via VITE_FIREBASE_STORAGE_ENABLED=true in .env after provisioning Cloud Storage in Firebase Console.
  if (import.meta.env.VITE_FIREBASE_STORAGE_ENABLED === "true") {
    return Boolean(
      firebaseConfig.storageBucket &&
      !firebaseConfig.storageBucket.includes("your-project-id")
    );
  }
  return false;
}

export default app;
