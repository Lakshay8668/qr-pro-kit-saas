// src/lib/firebase.js
// Initializes Firebase once and exports the pieces the app needs.
// Gracefully handles missing services (e.g. Starter tier projects without Firestore/Storage).

import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
};

// Check if credentials appear configured (not placeholder / not empty)
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  !firebaseConfig.apiKey.includes("your_") &&
  !firebaseConfig.projectId.includes("your-project-id")
);

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// Lazy storage instance — does NOT initialize or import firebase/storage on app load
let _storage = null;
export async function getStorageInstance() {
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
