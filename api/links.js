// api/links.js — creates links with plan-limit enforcement (see api/_lib/links.js).
import { createLinksHandler } from "./_lib/links.js";
import { getDb, adminAuth, serverTs } from "./_lib/firebaseAdmin.js";

export default createLinksHandler({
  getDb,
  serverTs,
  verify: (token) => adminAuth().verifyIdToken(token, true),
});
