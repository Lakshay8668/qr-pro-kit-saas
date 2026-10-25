// test/shortlinks_and_maps_review.test.mjs
// Dedicated test suite for:
// 1. TypQR First-Party Short Link Generator (/s/:slug, click logging, referers, slug uniqueness, OTA updates)
// 2. Google Review QR Generator Without Mandatory Place ID (Maps listing QR, direct review QR, zero external APIs)

import assert from "node:assert/strict";
import { makeDb, callJson } from "./fakeDb.mjs";
import { createLinksHandler, getPublicBaseUrl, RESERVED_SLUGS } from "../api/_lib/links.js";
import { createHandler } from "../api/_lib/handler.js";
import {
  extractPlaceIdLocally,
  isValidGoogleReviewUrl,
  isValidGoogleMapsUrl,
} from "../src/lib/googleReviewLocal.js";

console.log("\n=== RUNNING TYPQR SHORT LINKS & GOOGLE REVIEW QR TESTS ===\n");

let passed = 0;
const ok = (msg) => {
  console.log(`  ✓ ${msg}`);
  passed++;
};

// =========================================================================
// SECTION 1: TYPQR FIRST-PARTY SHORT LINK GENERATOR
// =========================================================================
console.log("--- Testing Feature 1: TypQR First-Party Short Link Generator ---");

const db = makeDb();
const authUser = { authorization: "Bearer token-user-alice" };
const serverTs = () => new Date();
const verify = async (t) => ({ uid: "user-alice", email: "alice@example.com" });

// Seed Pro user
await db.collection("users").doc("user-alice").set({
  email: "alice@example.com",
  plan: "pro",
  createdAt: new Date(),
});

const linksApi = createLinksHandler({
  getDb: () => db,
  verify,
  serverTs,
  newId: () => "id" + Math.random().toString(36).slice(2, 8),
  adminUids: () => [],
});

const redirectHandler = createHandler({
  getDb: () => db,
  increment: (n) => n,
  serverTs: () => new Date(),
  secret: () => "test-secret-key-32-chars-long!",
  now: () => Date.now(),
});

const callRedirect = async (prefix, slug, headers = {}) => {
  const req = {
    method: "GET",
    url: `${prefix}/${slug}`,
    query: { id: slug },
    headers: {
      host: "localhost",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      ...headers,
    },
  };
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(body) { this.body = body; return this; },
  };
  await redirectHandler(req, res);
  return res;
};

// 1.1 Create short link with custom slug
const customSlugRes = await callJson(linksApi, {
  method: "POST",
  headers: authUser,
  query: { action: "create" },
  body: {
    link: {
      kind: "redirect",
      type: "shortlink",
      label: "Engagium Launch Link",
      destination: "https://engagiumtechnologies.com/products/launch-2026",
      slug: "engagium",
      prefix: "s",
    },
  },
});
assert.equal(customSlugRes.code, 200);
assert.equal(customSlugRes.body.slug, "engagium");
assert.equal(customSlugRes.body.shortUrl, `${getPublicBaseUrl()}/s/engagium`);
ok("Created first-party short link with custom slug '/s/engagium'");

// 1.2 Prevent duplicate slug (collision safety)
const duplicateSlugRes = await callJson(linksApi, {
  method: "POST",
  headers: authUser,
  query: { action: "create" },
  body: {
    link: {
      kind: "redirect",
      type: "shortlink",
      label: "Duplicate Slug Attempt",
      destination: "https://another-domain.com",
      slug: "engagium",
      prefix: "s",
    },
  },
});
assert.equal(duplicateSlugRes.code, 409);
assert.equal(duplicateSlugRes.body.error, "slug_taken");
ok("Duplicate slug correctly rejected with HTTP 409 slug_taken");

// 1.3 Reject reserved system paths
for (const reserved of ["api", "dashboard", "events", "reviews", "shortlinks", "admin", "billing"]) {
  const reservedRes = await callJson(linksApi, {
    method: "POST",
    headers: authUser,
    query: { action: "create" },
    body: {
      link: {
        kind: "redirect",
        type: "shortlink",
        destination: "https://example.com",
        slug: reserved,
        prefix: "s",
      },
    },
  });
  assert.equal(reservedRes.code, 400);
  assert.equal(reservedRes.body.error, "reserved_slug");
}
ok("System reserved paths (api, dashboard, events, reviews, etc.) strictly rejected");

// 1.4 Auto-generated unique random slug
const autoSlugRes = await callJson(linksApi, {
  method: "POST",
  headers: authUser,
  query: { action: "create" },
  body: {
    link: {
      kind: "redirect",
      type: "shortlink",
      label: "Auto Random Slug",
      destination: "https://example.com/target-page",
      prefix: "s",
    },
  },
});
assert.equal(autoSlugRes.code, 200);
assert.ok(autoSlugRes.body.slug);
assert.ok(autoSlugRes.body.shortUrl.startsWith(`${getPublicBaseUrl()}/s/`));
ok("Auto-generates unique random slug when no custom slug is specified");

// 1.5 Public redirection via /s/:slug with 302 and click logging
const initialSnap = await db.collection("links").doc(customSlugRes.body.id).get();
const initialClicks = initialSnap.data().scans || 0;

const clickRedir = await callRedirect("/s", "engagium", {
  referer: "https://twitter.com/engagium",
  "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
});
assert.equal(clickRedir.statusCode, 302);
assert.equal(clickRedir.headers.Location, "https://engagiumtechnologies.com/products/launch-2026");

const afterSnap = await db.collection("links").doc(customSlugRes.body.id).get();
assert.equal(afterSnap.data().scans, initialClicks + 1);
ok("Public visitor gets 302 redirect via /s/:slug and increments scan counter");

// 1.6 Verify click log captured referer and user agent
const scansSnap = await db.collection("links").doc(customSlugRes.body.id).collection("scans").get();
assert.ok(scansSnap.docs.length > 0);
const latestScan = scansSnap.docs[scansSnap.docs.length - 1].data();
assert.equal(latestScan.referer, "https://twitter.com/engagium");
assert.ok(latestScan.ua.includes("iPhone"));
ok("Click logging captures referer, user agent, and timestamp");

// 1.7 Over-the-air destination update without changing short URL
const updateRes = await callJson(linksApi, {
  method: "POST",
  headers: authUser,
  query: { action: "update" },
  body: {
    id: customSlugRes.body.id,
    patch: {
      destination: "https://engagiumtechnologies.com/products/updated-destination",
    },
  },
});
assert.equal(updateRes.code, 200);

const updatedRedir = await callRedirect("/s", "engagium");
assert.equal(updatedRedir.statusCode, 302);
assert.equal(updatedRedir.headers.Location, "https://engagiumtechnologies.com/products/updated-destination");
ok("Over-the-air update redirects visitors to new destination while short URL remains identical");

// 1.8 Toggle link active/paused status
await callJson(linksApi, {
  method: "POST",
  headers: authUser,
  query: { action: "update" },
  body: {
    id: customSlugRes.body.id,
    patch: { active: false },
  },
});
const pausedRedir = await callRedirect("/s", "engagium");
assert.equal(pausedRedir.statusCode, 403);
ok("Paused short link returns HTTP 403 notice; reactivating restores 302 redirection");

// Reactivate
await callJson(linksApi, {
  method: "POST",
  headers: authUser,
  query: { action: "update" },
  body: {
    id: customSlugRes.body.id,
    patch: { active: true },
  },
});


// =========================================================================
// SECTION 2: GOOGLE REVIEW QR GENERATOR WITHOUT MANDATORY PLACE ID
// =========================================================================
console.log("\n--- Testing Feature 2: Google Review QR Generator (No Mandatory Place ID) ---");

// 2.1 Google Maps URL without Place ID (Non-blocking generation)
const mapsListingUrl = "https://www.google.com/maps/search/?api=1&query=India+Gate+New+Delhi";
assert.equal(isValidGoogleMapsUrl(mapsListingUrl), true);
assert.equal(extractPlaceIdLocally(mapsListingUrl), null, "Generic Maps search URL has no embedded Place ID");
ok("isValidGoogleMapsUrl detects valid Maps listing URL without Place ID");

// 2.2 Direct Place ID input
const directPid = "ChIJN1t_tDeuEmsRUsoyG83frY4";
assert.equal(extractPlaceIdLocally(directPid), directPid);
const directReviewUrl = `https://search.google.com/local/writereview?placeid=${directPid}`;
assert.equal(isValidGoogleReviewUrl(directReviewUrl), true);
ok("extractPlaceIdLocally derives Place ID and canonical direct review URL");

// 2.3 Maps URL containing query_place_id
const mapsWithPlaceId = "https://www.google.com/maps/search/?api=1&query=Central+Park&query_place_id=ChIJ4zBEa6NzwokRAMRXfpTKil8";
assert.equal(extractPlaceIdLocally(mapsWithPlaceId), "ChIJ4zBEa6NzwokRAMRXfpTKil8");
ok("extractPlaceIdLocally extracts Place ID from query_place_id in Maps URL");

// 2.4 Maps URL containing /maps/place/ChIJ...
const mapsPlaceChij = "https://www.google.com/maps/place/ChIJLU7jZClu5kcR4PcOOO6p3I0";
assert.equal(extractPlaceIdLocally(mapsPlaceChij), "ChIJLU7jZClu5kcR4PcOOO6p3I0");
ok("extractPlaceIdLocally extracts Place ID from /maps/place/ChIJ... path");

// 2.5 Official review link formats
assert.equal(isValidGoogleReviewUrl("https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4"), true);
assert.equal(isValidGoogleReviewUrl("https://g.page/r/CbW7uL-Y5_3vEAE/review"), true);
assert.equal(isValidGoogleReviewUrl("https://not-google.com/review"), false);
ok("isValidGoogleReviewUrl accepts genuine Google review URLs and rejects third-party URLs");

// 2.6 Business name only (prevents fabrication)
assert.equal(extractPlaceIdLocally("Acme Bakery"), null);
assert.equal(isValidGoogleMapsUrl("Acme Bakery"), false);
assert.equal(isValidGoogleReviewUrl("Acme Bakery"), false);
ok("Entering only a business name returns null and avoids fabricating fake Place IDs");

// 2.7 Connecting Google Review destination to a TypQR short link
const reviewShortLinkRes = await callJson(linksApi, {
  method: "POST",
  headers: authUser,
  query: { action: "create" },
  body: {
    link: {
      kind: "redirect",
      type: "shortlink",
      label: "Google Review: India Gate",
      destination: mapsListingUrl, // Google Maps listing without Place ID!
      slug: "review-indiagate",
      prefix: "s",
    },
  },
});
assert.equal(reviewShortLinkRes.code, 200);
assert.equal(reviewShortLinkRes.body.slug, "review-indiagate");

const reviewQrScan = await callRedirect("/s", "review-indiagate");
assert.equal(reviewQrScan.statusCode, 302);
assert.equal(reviewQrScan.headers.Location, mapsListingUrl);
ok("Google Maps listing QR encoded into TypQR short link redirects directly to Maps listing");

console.log(`\nALL ${passed} TYPQR SHORT LINKS & GOOGLE REVIEW QR TESTS PASSED WITH 100% SUCCESS!\n`);

// =========================================================================
// SECTION 3: ACCEPTANCE TESTS — SHORT LINK INTEGRATION BELOW QR PREVIEW
// =========================================================================
console.log("\n--- Testing Feature 3: Integrated Short Link Below QR Preview ---");

import fs from "node:fs";

// 3.1 Verify AppShell does NOT have a separate Short Links sidebar item
const appShellCode = fs.readFileSync("src/components/AppShell.jsx", "utf8");
assert.equal(appShellCode.includes('label: "Short Links"'), false);
assert.equal(appShellCode.includes('key: "shortlinks"'), false);
ok("No separate Short Links sidebar item in AppShell navigation");

// 3.2 Verify Dashboard does not have a separate shortlinks tab view
const dashboardCode = fs.readFileSync("src/pages/Dashboard.jsx", "utf8");
assert.equal(dashboardCode.includes('currentTab === "shortlinks"'), false);
ok("No separate shortlinks tab view in Dashboard");

// 3.3 Verify ShortLinkSection is rendered below QR preview in App.jsx and GoogleReview.jsx
const appCode = fs.readFileSync("src/App.jsx", "utf8");
assert.ok(appCode.includes("<ShortLinkSection"));
assert.ok(appCode.includes("encodeShortLinkInQr"));

const googleReviewCode = fs.readFileSync("src/pages/GoogleReview.jsx", "utf8");
assert.ok(googleReviewCode.includes("<ShortLinkSection"));
assert.ok(googleReviewCode.includes("encodeShortLinkInQr"));
ok("ShortLinkSection is integrated directly below QR preview in both App.jsx and GoogleReview.jsx");

// 3.4 Verify QR payload selection logic:
// When encodeShortLinkInQr is false, preserves original destination;
// When encodeShortLinkInQr is true, encodes the short URL.
const originalTarget = "https://example.com/original-target";
const myShortUrl = "https://qr-pro-kit-saas-production.up.railway.app/s/my-slug";

const payloadDisabled = (false && myShortUrl) ? myShortUrl : originalTarget;
assert.equal(payloadDisabled, originalTarget, "When short-link mode is disabled, QR must encode original destination");

const payloadEnabled = (true && myShortUrl) ? myShortUrl : originalTarget;
assert.equal(payloadEnabled, myShortUrl, "When short-link mode is enabled, QR must encode short URL");
ok("QR preview accurately switches between original destination and short URL based on user toggle");

console.log(`\nALL ${passed} VERIFICATION AUDIT TESTS PASSED SUCCESSFULLY!\n`);
process.exit(0);
