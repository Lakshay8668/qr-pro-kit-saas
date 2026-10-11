// api/q/[id].js — Vercel serverless function (Node). Rewritten from /q/:id (see vercel.json).
// Needs env var FIREBASE_SERVICE_ACCOUNT (service-account JSON, raw or base64).
import { createHandler } from "../_lib/handler.js";
import { createQuota } from "../_lib/quota.js";
import { getDb, increment, serverTs, cookieSecret } from "../_lib/firebaseAdmin.js";

export default createHandler({ getDb, secret: cookieSecret, increment, serverTs, quota: createQuota({ getDb, increment, serverTs }) });
