// api/admin.js — Vercel function for the admin dashboard (/admin).
// Env vars: FIREBASE_SERVICE_ACCOUNT (already set) and ADMIN_UIDS (comma-separated Firebase UIDs).
import { createAdminHandler } from "./_lib/admin.js";
import { getDb, adminAuth, serverTs } from "./_lib/firebaseAdmin.js";

export default createAdminHandler({
  getDb,
  serverTs,
  verify: (token) => adminAuth().verifyIdToken(token, true),
  adminUids: () => (process.env.ADMIN_UIDS || "").split(",").map((s) => s.trim()).filter(Boolean),
  setAuthDisabled: (uid, disabled) => adminAuth().updateUser(uid, { disabled }),
});
