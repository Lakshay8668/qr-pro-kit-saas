// api/billing.js — pricing/billing API (see api/_lib/billing.js).
import { createBillingHandler } from "./_lib/billing.js";
import { createStripe, createRazorpay, getRazorpayCredentials } from "./_lib/providers.js";
import { getDb, serverTs } from "./_lib/firebaseAdmin.js";
import { verifyToken } from "./_lib/auth.js";

export default createBillingHandler({
  getDb,
  serverTs,
  env: () => process.env,
  verify: verifyToken,
  makeStripe: (opts) => createStripe({ secret: opts?.secret || process.env.STRIPE_SECRET_KEY }),
  makeRazorpay: (opts) => {
    const creds = opts || getRazorpayCredentials(process.env);
    return createRazorpay({ keyId: creds.keyId, keySecret: creds.keySecret });
  },
});
