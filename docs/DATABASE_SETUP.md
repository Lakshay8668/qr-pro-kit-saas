# QR Pro SaaS — Database & Firebase Configuration Guide

This guide explains how persistent storage works in QR Pro SaaS and how to configure Cloud Firestore or an alternative backend database (PostgreSQL) for project **`delta-abbey-4f38q`**.

---

## 1. Cloud Firestore Setup (Recommended & Native)

QR Pro is architected around Firebase Authentication, Cloud Firestore, and Vercel Serverless Functions. On the Firebase standard **Spark (Free) Tier**, Cloud Firestore includes:
- **1 GiB** stored data
- **50,000 document reads / day**
- **20,000 document writes / day**
- **20,000 document deletes / day**
- **Cost: $0 / month (No credit card required)**

### Why did you see `Database (default) not found`?
When a Firebase project is initialized via Google AI Studio or Google Cloud without manually visiting the Firestore console, the `(default)` database is not provisioned automatically.

### Steps to Enable Cloud Firestore:
1. Open the [Firebase Console Firestore Page for delta-abbey-4f38q](https://console.firebase.google.com/project/delta-abbey-4f38q/firestore).
2. Click **Create database**.
3. Choose Database ID: **`(default)`** (leave as default).
4. Select a location close to your users (e.g., `asia-south1` for Mumbai, India or `us-central1`).
5. Choose **Start in production mode** (or test mode).
6. Click **Create**.
7. Once created, deploy your security rules:
   - In the Firebase Console, go to **Firestore Database** → **Rules**.
   - Copy the contents of [`firestore.rules`](../firestore.rules) into the editor.
   - Click **Publish**.

---

## 2. Serverless Backend Credentials (`FIREBASE_SERVICE_ACCOUNT`)

The frontend never touches private service account keys. Dynamic QR generation, scan rate-limiting, and Stripe/Razorpay webhooks are handled by the serverless functions in `/api`.

1. Go to **Firebase Console** → ⚙️ **Project settings** → **Service accounts**.
2. Click **Generate new private key** and download the JSON file.
3. In **Vercel** (or your server environment):
   - Navigate to **Project Settings** → **Environment Variables**.
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Value: Paste the full JSON string or its base64 encoding.
4. Add your Firebase Authentication UID to `ADMIN_UIDS` in Vercel to access `/admin`.

---

## 3. Alternative Database Option: PostgreSQL

If you cannot or choose not to use Cloud Firestore in Firebase, persistent storage can be hosted on a PostgreSQL database (e.g., Supabase, Neon, AWS RDS, Railway, or local PostgreSQL).

### PostgreSQL Schema DDL:

```sql
-- 1. Users & Profiles
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(128) PRIMARY KEY, -- Firebase Auth UID
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  plan VARCHAR(32) DEFAULT 'free',
  plan_status VARCHAR(32) DEFAULT 'active',
  plan_interval VARCHAR(32),
  current_period_end BIGINT DEFAULT 0,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  plan_source VARCHAR(64),
  billing JSONB DEFAULT '{}'::jsonb,
  disabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Links / QR Codes
CREATE TABLE IF NOT EXISTS links (
  id VARCHAR(32) PRIMARY KEY, -- Short alphanumeric ID
  owner_id VARCHAR(128) REFERENCES users(id) ON DELETE CASCADE,
  kind VARCHAR(32) NOT NULL, -- 'redirect', 'bio', 'static'
  type VARCHAR(32) NOT NULL, -- 'url', 'upi', 'pdf', 'vcard', etc.
  destination TEXT,
  payload TEXT,
  destinations JSONB, -- { "ios": "...", "android": "..." }
  bio JSONB, -- { "title": "...", "links": [...] }
  password JSONB, -- { "salt": "...", "hash": "...", "iter": 100000 }
  label VARCHAR(255) DEFAULT 'Untitled',
  design JSONB, -- { "fg": "#...", "bg": "#...", "shape": "..." }
  scans INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  max_scans INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_links_owner ON links(owner_id);
CREATE INDEX IF NOT EXISTS idx_links_active ON links(active);

-- 3. Scans & Analytics
CREATE TABLE IF NOT EXISTS scans (
  id BIGSERIAL PRIMARY KEY,
  link_id VARCHAR(32) REFERENCES links(id) ON DELETE CASCADE,
  ts BIGINT NOT NULL,
  ev VARCHAR(32) DEFAULT 'scan', -- 'scan' or 'click'
  target TEXT,
  vid VARCHAR(128),
  device VARCHAR(64),
  os VARCHAR(64),
  browser VARCHAR(64),
  lang VARCHAR(32),
  country VARCHAR(64),
  region VARCHAR(64),
  city VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scans_link_ts ON scans(link_id, ts DESC);

-- 4. Monthly Usage Tracking
CREATE TABLE IF NOT EXISTS usage (
  id VARCHAR(64) PRIMARY KEY, -- '{uid}_{YYYY-MM}'
  owner_id VARCHAR(128) REFERENCES users(id) ON DELETE CASCADE,
  month VARCHAR(7) NOT NULL, -- 'YYYY-MM'
  scans INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Admin Audit Log
CREATE TABLE IF NOT EXISTS admin_log (
  id BIGSERIAL PRIMARY KEY,
  admin_uid VARCHAR(128) NOT NULL,
  action VARCHAR(64) NOT NULL,
  target VARCHAR(128),
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 4. Cloud Storage (PDF & Menu Uploads)

- **Standard QR Types**: URL, WiFi, UPI, vCard, WhatsApp, SMS, Text, Event, Crypto — **Never require Cloud Storage**.
- **PDF Menus & File QRs**:
  - If Firebase Cloud Storage is enabled in the Firebase Console (Build → Storage), users can upload files up to 10 MB.
  - If Storage is not enabled, users can simply paste any direct URL (e.g. Google Drive link, S3 URL, CDN link) in the newly added "Direct file URL" field.
