// api/events.js — Event Management & Check-In Route Handler
import { createEventsHandler } from "./_lib/events.js";
import { getDb, serverTs } from "./_lib/firebaseAdmin.js";
import { verifyToken } from "./_lib/auth.js";

export default createEventsHandler({
  getDb,
  serverTs,
  verify: verifyToken,
});
