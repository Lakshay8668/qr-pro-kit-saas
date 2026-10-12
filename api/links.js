// api/links.js — creates & manages links with plan-limit enforcement.
import { createLinksHandler } from "./_lib/links.js";
import { getDb, serverTs } from "./_lib/firebaseAdmin.js";
import { verifyToken } from "./_lib/auth.js";

export default createLinksHandler({
  getDb,
  serverTs,
  verify: verifyToken,
});
