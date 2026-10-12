// api/billing.js — pricing/billing API (see api/_lib/billing.js).
import { createBillingHandler } from "./_lib/billing.js";
import { createStripe, createRazorpay } from "./_lib/providers.js";
import { getDb, serverTs } from "./_lib/firebaseAdmin.js";
import { verifyToken } from "./_lib/auth.js";

export default createBillingHandler({
  getDb,
  serverTs,
  env: () => process.env,
  verify: verifyToken,
  makeStripe: () => createStripe({ secret: process.env.STRIPE_SECRET_KEY }),
  makeRazorpay: () => createRazorpay({ keyId: process.env.RAZORPAY_KEY_ID, keySecret: process.env.RAZORPAY_KEY_SECRET }),
});
