// api/admin.js — production function for the admin dashboard (/admin).
// Env vars: ADMIN_UIDS (comma-separated Firebase UIDs).
import { createAdminHandler } from "./_lib/admin.js";
import { getDb, adminAuth, serverTs } from "./_lib/firebaseAdmin.js";
import { verifyToken } from "./_lib/auth.js";
import { getAdminUids } from "./_lib/adminAuth.js";

export default createAdminHandler({
  getDb,
  serverTs,
  verify: verifyToken,
  adminUids: () => getAdminUids(process.env),
  setAuthDisabled: (uid, disabled) => {
    try {
      return adminAuth().updateUser(uid, { disabled });
    } catch {
      return Promise.resolve();
    }
  },
});
