// api/r/[slug].js — Vercel serverless function for Bitly-style TypQR short URLs (/r/:slug)
import { createHandler } from "../_lib/handler.js";
import { createQuota } from "../_lib/quota.js";
import { getDb, increment, serverTs, cookieSecret } from "../_lib/firebaseAdmin.js";

export default createHandler({ getDb, secret: cookieSecret, increment, serverTs, quota: createQuota({ getDb, increment, serverTs }) });
