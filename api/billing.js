// api/billing.js — pricing/billing API (see api/_lib/billing.js).
import { createBillingHandler } from "./_lib/billing.js";
import { createStripe, createRazorpay } from "./_lib/providers.js";
import { getDb, adminAuth, serverTs } from "./_lib/firebaseAdmin.js";

export default createBillingHandler({
  getDb,
  serverTs,
  env: () => process.env,
  verify: (token) => adminAuth().verifyIdToken(token, true),
  makeStripe: () => createStripe({ secret: process.env.STRIPE_SECRET_KEY }),
  makeRazorpay: () => createRazorpay({ keyId: process.env.RAZORPAY_KEY_ID, keySecret: process.env.RAZORPAY_KEY_SECRET }),
});
