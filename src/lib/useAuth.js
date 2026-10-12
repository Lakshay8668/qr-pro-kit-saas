// src/lib/useAuth.js
// Multi-tenant auth: any user can sign up and manage their own links.
// Isolation is enforced by ownerId on every link + Firestore rules.

import { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { auth, isFirebaseConfigured } from "./firebase";
import { ensureUserDoc } from "./users";

export function useAuth() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = logged out

  useEffect(() => {
    if (!auth) {
      setUser(null);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) ensureUserDoc(u);
    });
    return unsub;
  }, []);

  const ensureAuth = () => {
    if (!auth) {
      throw new Error(
        "Authentication is not configured. Please add VITE_FIREBASE_API_KEY and VITE_FIREBASE_PROJECT_ID to your environment variables."
      );
    }
  };

  return {
    user,
    loading: user === undefined,
    isConfigured: isFirebaseConfigured && !!auth,
    login: (email, password) => {
      ensureAuth();
      return signInWithEmailAndPassword(auth, email, password);
    },
    loginWithGoogle: () => {
      ensureAuth();
      const provider = new GoogleAuthProvider();
      return signInWithPopup(auth, provider);
    },
    signup: async (email, password, displayName) => {
      ensureAuth();
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName?.trim()) {
        await updateProfile(cred.user, { displayName: displayName.trim() });
      }
      return cred;
    },
    resetPassword: (email) => {
      ensureAuth();
      return sendPasswordResetEmail(auth, email);
    },
    logout: () => {
      if (!auth) return Promise.resolve();
      return signOut(auth);
    },
  };
}
