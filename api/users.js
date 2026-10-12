// api/users.js — Customer Profile & Account Sync API
import { getDb, serverTs } from "./_lib/firebaseAdmin.js";
import { verifyToken } from "./_lib/auth.js";
import { ensureUser } from "./_lib/userStore.js";

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  try {
    const action = String(req.query?.action || "sync");
    const token = String(req.headers.authorization || req.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return json(res, 401, { error: "sign_in_required", message: "Please sign in first." });

    let me;
    try {
      me = await verifyToken(token);
    } catch (err) {
      return json(res, 401, { error: "bad_token", message: "Your session expired — sign in again." });
    }

    const db = getDb();
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    if (req.method === "POST" && action === "sync") {
      const user = await ensureUser(db, me, serverTs, body);
      return json(res, 200, { ok: true, user });
    }

    if (req.method === "GET" && action === "me") {
      const user = await ensureUser(db, me, serverTs);
      return json(res, 200, { ok: true, user });
    }

    return json(res, 400, { error: "unknown_action", message: "Action not recognized." });
  } catch (err) {
    console.error("[Users API] Error:", err);
    return json(res, 500, { error: "server_error", message: err.message || "Failed to process user request." });
  }
}
