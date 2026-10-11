# QR Pro v9 — SaaS Edition (plans, payments, usage limits)

v9 turns the v8 app into a real subscription product on the same React + Vite + Firebase + Vercel stack.

| Area | What v9 adds |
|---|---|
| **Plans** | Free / Pro / Business, defined once in `shared/plans.js` (limits, features, display prices) and used by both the UI and the server |
| **Payments** | Stripe Checkout (+ customer portal) and Razorpay Subscriptions, via plain REST calls (no new dependencies) |
| **Usage limits** | editable-QR count, saved-static count, **monthly scans**, plus feature gates: password, per-device redirects, bulk |
| **Enforcement** | server-side only: `api/links.js` (creation), `api/_lib/quota.js` (every scan), `firestore.rules` (feature gates on edits) |
| **UI** | `/pricing`, `/billing` (usage meters, manage / cancel), plan badge in the top bar, usage strip + upgrade prompts in the dashboard |
| **Admin** | plan per customer, MRR-style counts, grant / comp / reset a plan (`/admin` → Customers) |

## Default plans (edit `shared/plans.js`)

| | Free | Pro | Business |
|---|---|---|---|
| Price (INR, shown on the pricing page) | 0 | 299/mo · 2,990/yr | 999/mo · 9,990/yr |
| Editable (dynamic) QR codes | 3 | 50 | 500 |
| Saved static QR codes | 50 | 500 | 5,000 |
| Tracked scans / month | 500 | 20,000 | 200,000 |
| Password-protected QR | – | ✓ | ✓ |
| Per-device (iOS/Android) redirects | – | ✓ | ✓ |
| Bulk CSV → ZIP | – | ✓ | ✓ |

The numbers are placeholders — change them freely. **The amount actually charged is whatever the Stripe Price / Razorpay Plan says**; keep the displayed price in `shared/plans.js` in sync with it.

## Deployment on Railway

QR Pro Kit v9 is ready for production deployment on [Railway](https://railway.com/) using the native Node production server (`server.js`).

### 1. Push code to GitHub
```bash
git init
git add .
git commit -m "feat: complete QR Pro Kit SaaS with Razorpay subscriptions and Railway server"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/qr-pro-kit.git
git push -u origin main
```
> [!IMPORTANT]
> The `.gitignore` file strictly excludes `.env`, `service-account*.json`, and private keys. Never commit live secrets or credentials to GitHub.

### 2. Deploy on Railway
1. Go to [Railway Dashboard](https://railway.com/dashboard) and click **New Project** → **Deploy from GitHub repo**.
2. Select your `qr-pro-kit` repository.
3. Railway automatically detects Node.js:
   - **Build Command**: `npm run build` (builds the Vite client into `dist/`)
   - **Start Command**: `npm start` (runs `node server.js`)
4. In Railway **Settings** → **Networking**, click **Generate Domain** (e.g. `qr-pro-kit-production.up.railway.app`).
5. In Railway **Variables**, configure:
   - `PORT`: (automatically provided by Railway, or defaults to 3000)
   - `APP_URL`: `https://YOUR-RAILWAY-DOMAIN` (e.g. `https://qr-pro-kit-production.up.railway.app`)
   - `FIREBASE_SERVICE_ACCOUNT`: `<raw or base64 JSON of your Firebase Admin service account>`
   - `ADMIN_UIDS`: `<your Firebase UID>`
   - `RAZORPAY_KEY_ID`: `rzp_live_...` (or `rzp_test_...` for testing)
   - `RAZORPAY_KEY_SECRET`: `<your Razorpay Secret>`
   - `RAZORPAY_WEBHOOK_SECRET`: `<a secure random string chosen by you>`
   - `RAZORPAY_PLAN_PRO_MONTHLY`: `plan_...`
   - `RAZORPAY_PLAN_PRO_YEARLY`: `plan_...`
   - `RAZORPAY_PLAN_BUSINESS_MONTHLY`: `plan_...`
   - `RAZORPAY_PLAN_BUSINESS_YEARLY`: `plan_...`
   - Plus your client `VITE_FIREBASE_*` variables if rebuilding on Railway.

---

## Razorpay Subscriptions Setup

### 1. Create Subscription Plans in Razorpay Dashboard
Go to **Razorpay Dashboard** → **Subscriptions** → **Plans** → **+ Create Plan**:
- **Pro Monthly**: Period: `Monthly`, Interval: `1`, Amount: `₹299` → Copy Plan ID to `RAZORPAY_PLAN_PRO_MONTHLY`
- **Pro Yearly**: Period: `Yearly`, Interval: `1`, Amount: `₹2,990` → Copy Plan ID to `RAZORPAY_PLAN_PRO_YEARLY`
- **Business Monthly**: Period: `Monthly`, Interval: `1`, Amount: `₹999` → Copy Plan ID to `RAZORPAY_PLAN_BUSINESS_MONTHLY`
- **Business Yearly**: Period: `Yearly`, Interval: `1`, Amount: `₹9,990` → Copy Plan ID to `RAZORPAY_PLAN_BUSINESS_YEARLY`

### 2. Configure Webhook in Razorpay Dashboard
1. Go to **Settings** → **Webhooks** → **+ Add New Webhook**.
2. **Webhook URL**:
   `https://YOUR-RAILWAY-DOMAIN/api/webhooks/razorpay`
   *(Example: `https://qr-pro-kit-production.up.railway.app/api/webhooks/razorpay`)*
3. **Secret**: Enter a secure secret and save the same string in `RAZORPAY_WEBHOOK_SECRET`.
4. **Active Events**: Select all subscription lifecycle events:
   - `subscription.activated` (plan becomes active upon initial payment)
   - `subscription.charged` (successful renewal charge updates period end)
   - `subscription.pending` (payment failure enters grace period)
   - `subscription.halted` (retries exhausted, cancels subscription)
   - `subscription.cancelled` (cancelled by user or merchant)
   - `subscription.completed` (subscription reached total cycle limit)
   - `subscription.updated` (plan or schedule update)

---

## Setup & Local Development

1. `npm install`, copy `.env.example` → `.env`, fill the Firebase web config.
2. Publish `firestore.rules` if using Firestore.
3. Start development server:
   - Frontend development: `npm run dev`
   - Full-stack production server: `npm run build && npm start`
4. Run automated test suite: `npm test` (verifies 68 checks across routing, webhooks, auth, and quotas).

## How enforcement works (and why it can't be bypassed from the browser)

* **A plan is only ever granted by a signature-verified webhook** (or by an admin). `/api/billing?action=checkout` just sends the customer to the provider's hosted page; the server picks the price id from env, so the browser can't choose its own price or plan. Webhook events are de-duplicated (`billingEvents`), order-checked, and a late "cancelled" for an old subscription can't wipe a newer one.
* **Creating QR codes** goes through `api/links.js`, which re-validates the data, counts what the customer already owns, and refuses with HTTP 402 `limit_reached` / `feature_locked`. Clients can no longer create link documents directly (`firestore.rules`).
* **Scans** are counted per owner per month in `usage/{uid}_{yyyymm}`. Over the allowance, `/q/:id` shows a "Monthly scan limit reached" page (HTTP 429). Bots and HEAD requests aren't counted. If the quota lookup itself fails, the scan is let through (fail-open) so printed codes don't break.
* **Edits** made directly from the dashboard are gated by `firestore.rules` using the server-written `users/{uid}.ent` snapshot: owners can't switch on a password or per-device redirects without the plan, can't change `kind` (static → dynamic), `ownerId` or `scans`.

### Billing lifecycle
| Provider state | What the customer gets |
|---|---|
| active | the plan (3 days of slack if a renewal webhook is late) |
| cancelled (at period end) | the plan until the period they paid for ends, then Free |
| past_due (card failed) | the plan for a 5-day grace period while the provider retries, then Free |

**Downgrades never delete anything.** A customer over the Free limits keeps all existing QR codes working (scan allowance permitting) — they just can't create more, and can still remove a password.

## Operating it

* `/admin` → *Customers*: each row has a plan dropdown (grant for N days or with no expiry; "Free" resets). A later provider webhook for that customer overwrites a manual grant.
* Everything is logged to `adminLog`; billing events to `billingEvents`.
* `npm test` runs 62 checks with in-memory fakes (no Firebase, no network): plan rules, limit enforcement, bulk all-or-nothing, webhook signatures + idempotency + ordering for both providers, checkout/cancel/portal, scan quota, admin grants.

## Known limitations — read before charging real money

* **Not exercised against live Stripe/Razorpay/Firebase** in the environment this was built in (no network). The REST payloads and webhook field names follow each provider's documented API and are covered by tests with fakes, but do a full test-mode run (checkout → webhook → plan active → cancel) in both providers before going live.
* **Razorpay plan changes**: Razorpay has no customer portal; customers cancel (effective at period end) and subscribe again. Stripe customers change plan in the portal.
* **No GST invoices / tax handling, coupons UI, trials, refunds or team seats** — Stripe/Razorpay dashboards cover invoices and refunds; the rest is future work.
* **Create-limit races**: two simultaneous create requests can overshoot a limit by one or two. Acceptable for QR counts; use a counter transaction if you need hard guarantees.
* **Scan quota cost**: each scan now does 2 extra Firestore reads (user + usage) and 1 write. Fine at early scale; cache entitlements per instance if scan volume grows.
* Months for the scan allowance roll over at 00:00 UTC (05:30 IST).
* Admin aggregation is still a capped full scan (v8 behaviour).
