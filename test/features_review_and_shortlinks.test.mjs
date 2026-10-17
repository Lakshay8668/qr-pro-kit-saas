// test/features_review_and_shortlinks.test.mjs
// Comprehensive test suite for:
// 1. Feature 1: ProductMate-Style Google Review Link Generator
// 2. Feature 2: Bitly-Style TypQR Short Links for Dynamic QR Codes

import assert from "node:assert/strict";
import { makeDb, callJson } from "./fakeDb.mjs";
import { createLinksHandler, getPublicBaseUrl } from "../api/_lib/links.js";
import { createHandler } from "../api/_lib/handler.js";
import { resolveGoogleMapsUrl, extractPlaceIdFromUrl, isValidPlaceId, buildGoogleReviewUrl } from "../api/_lib/googleReview.js";
import { buildPayload, getDynamicDestinations } from "../src/lib/qrPayloads.js";
import { shortUrlFor, dynamicUrlFor } from "../src/lib/links.js";

console.log("\n=== RUNNING FEATURE 1 & FEATURE 2 VERIFICATION SUITE ===\n");

let passed = 0;
const ok = (msg) => {
  console.log(`  ✓ ${msg}`);
  passed++;
};

// =========================================================================
// SECTION 1: FEATURE 1 — GOOGLE REVIEW LINK GENERATOR
// =========================================================================
console.log("--- Testing Feature 1: Google Review Link Generator ---");

// 1.1 Place ID Validation
assert.equal(isValidPlaceId("ChIJN1t_tDeuEmsRUsoyG83frY4"), true);
assert.equal(isValidPlaceId("GhIJN1t_tDeuEmsRUsoyG83frY4"), true);
assert.equal(isValidPlaceId("not-a-place-id"), false);
assert.equal(isValidPlaceId("https://google.com"), false);
assert.equal(isValidPlaceId(""), false);
ok("isValidPlaceId validates genuine Google Place IDs and rejects arbitrary strings");

// 1.2 Canonical Review URL Builder
const placeId1 = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const canonicalReview = buildGoogleReviewUrl(placeId1);
assert.equal(canonicalReview, `https://search.google.com/local/writereview?placeid=${placeId1}`);
ok("buildGoogleReviewUrl generates canonical write-review link format");

// 1.3 Place ID Extraction from various Google Maps formats
// Format A: Direct Place ID
assert.equal(extractPlaceIdFromUrl(placeId1), placeId1);

// Format B: placeid query parameter
assert.equal(
  extractPlaceIdFromUrl("https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4"),
  placeId1
);
assert.equal(
  extractPlaceIdFromUrl("https://maps.google.com/?place_id=ChIJN1t_tDeuEmsRUsoyG83frY4"),
  placeId1
);

// Format C: q=place_id:... query parameter
assert.equal(
  extractPlaceIdFromUrl("https://www.google.com/maps/search/?api=1&query=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4"),
  placeId1
);

// Format D: data=!1sChIJ... parameter
assert.equal(
  extractPlaceIdFromUrl("https://www.google.com/maps/place/Business+Name/@28.61,77.20,17z/data=!4m6!3m5!1sChIJN1t_tDeuEmsRUsoyG83frY4!8m2!3d28.61!4d77.20"),
  placeId1
);
ok("extractPlaceIdFromUrl extracts Place IDs across all supported Google Maps link structures");

// 1.4 Mock redirect resolution for short links (maps.app.goo.gl, share.google)
const mockFetchShortLink = async (url) => {
  if (url === "https://maps.app.goo.gl/sampleShort123") {
    return {
      status: 302,
      headers: new Headers({
        location: "https://www.google.com/maps/place/Cafe/@28.61,77.20/data=!4m6!3m5!1sChIJN1t_tDeuEmsRUsoyG83frY4!8m2!3d28.61",
      }),
    };
  }
  if (url === "https://share.google/bizShort456") {
    return {
      status: 301,
      headers: new Headers({
        location: "https://maps.google.com/?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4",
      }),
    };
  }
  return { status: 404, headers: new Headers() };
};

const shortLinkRes = await resolveGoogleMapsUrl("https://maps.app.goo.gl/sampleShort123", mockFetchShortLink);
assert.equal(shortLinkRes.ok, true);
assert.equal(shortLinkRes.placeId, placeId1);
assert.equal(shortLinkRes.reviewUrl, canonicalReview);
ok("resolveGoogleMapsUrl follows short link redirects and extracts Place ID");

const shareGoogleRes = await resolveGoogleMapsUrl("https://share.google/bizShort456", mockFetchShortLink);
assert.equal(shareGoogleRes.ok, true);
assert.equal(shareGoogleRes.placeId, placeId1);
assert.equal(shareGoogleRes.reviewUrl, canonicalReview);
ok("resolveGoogleMapsUrl resolves share.google short links safely");

// 1.5 SSRF and domain restrictions
const nonGoogleRes = await resolveGoogleMapsUrl("https://attacker.com/evil-redirect");
assert.equal(nonGoogleRes.ok, false);
assert.ok(nonGoogleRes.error.includes("official Google Maps"));
ok("SSRF guard strictly rejects non-Google domains");

// 1.6 Unresolvable links return actionable error for manual fallback
const mockUnresolvableFetch = async () => ({
  status: 200,
  url: "https://www.google.com/maps",
  headers: new Headers(),
  text: async () => "<html><body>No Place ID here</body></html>",
});
const unresolvableRes = await resolveGoogleMapsUrl("https://maps.google.com/unresolvable", mockUnresolvableFetch);
assert.equal(unresolvableRes.ok, false);
assert.ok(unresolvableRes.error.includes("Could not automatically resolve"));
ok("Unresolvable link returns actionable error advising manual input fallback");

// 1.7 QR Payload builder for review type
const payloadWithPlaceId = buildPayload("review", { placeId: placeId1 });
assert.equal(payloadWithPlaceId, canonicalReview);

const payloadWithReviewUrl = buildPayload("review", { reviewUrl: canonicalReview });
assert.equal(payloadWithReviewUrl, canonicalReview);

const payloadWithRawPastedUrl = buildPayload("review", { placeId: "https://g.page/r/sample/review" });
assert.equal(payloadWithRawPastedUrl, "https://g.page/r/sample/review");
ok("buildPayload('review') accurately encodes canonical Google review URL or official direct link");

// 1.8 Public API endpoint (no auth required)
const fakeDbInstance = makeDb();
const linksHandler = createLinksHandler({
  getDb: () => fakeDbInstance,
  verify: async () => ({ uid: "u1" }),
  serverTs: () => "TS",
  now: () => Date.now(),
  adminUids: ["admin1"],
});

// Call resolve-google-review publicly (WITHOUT auth header)
let apiReviewRes = await callJson(linksHandler, {
  method: "POST",
  query: { action: "resolve-google-review" },
  body: { url: placeId1 },
});
assert.equal(apiReviewRes.code, 200);
assert.equal(apiReviewRes.body.ok, true);
assert.equal(apiReviewRes.body.placeId, placeId1);
assert.equal(apiReviewRes.body.reviewUrl, canonicalReview);
ok("POST /api/links?action=resolve-google-review works publicly without authentication");


// =========================================================================
// SECTION 2: FEATURE 2 — BITLY-STYLE TYPQR SHORT LINKS FOR DYNAMIC QR CODES
// =========================================================================
console.log("\n--- Testing Feature 2: TypQR Short Links for Dynamic QR Codes ---");

const authCustomer = { authorization: "Bearer mock_token_customer" };
const mockVerify = async () => ({ uid: "cust_101", email: "customer@example.com" });

const db = makeDb({
  users: {
    cust_101: { uid: "cust_101", plan: "pro" },
  },
});

let generatedSlugs = ["dupSlug1", "dupSlug1", "uniqueSlug2"];
let slugIndex = 0;
const mockSlugGenerator = () => generatedSlugs[slugIndex++];

const linksApi = createLinksHandler({
  getDb: () => db,
  verify: mockVerify,
  serverTs: () => "TS",
  now: () => Date.now(),
  newId: () => "dynQR_" + Math.random().toString(36).slice(2, 8),
  adminUids: [],
});

// 2.1 Dynamic QR Link Generation with Slug & TypQR Short URL
let createRes = await callJson(linksApi, {
  method: "POST",
  headers: authCustomer,
  query: { action: "create" },
  body: {
    link: {
      kind: "redirect",
      type: "url",
      label: "Campaign Promo",
      destination: "https://shop.example.com/summer-sale",
    },
  },
});

assert.equal(createRes.code, 200);
assert.ok(createRes.body.id, "Link ID must be returned");
assert.ok(createRes.body.slug, "Short slug must be returned");
assert.ok(createRes.body.shortUrl, "Full short URL must be returned");
assert.ok(createRes.body.shortUrl.includes(`/r/${createRes.body.slug}`));

const dynId = createRes.body.id;
const dynSlug = createRes.body.slug;
const dynShortUrl = createRes.body.shortUrl;
ok(`Dynamic QR created with persistent slug: ${dynSlug} and short URL: ${dynShortUrl}`);

// 2.2 Verify persistent database record
const docSnap = await db.collection("links").doc(dynId).get();
assert.equal(docSnap.exists, true);
const docData = docSnap.data();
assert.equal(docData.slug, dynSlug);
assert.equal(docData.shortUrl, dynShortUrl);
assert.equal(docData.destination, "https://shop.example.com/summer-sale");
assert.equal(docData.scans, 0);
ok("Slug-to-destination mapping and short URL safely persisted in database");

// 2.3 Verify shortUrlFor and dynamicUrlFor helper functions
assert.equal(shortUrlFor(dynSlug), dynShortUrl);
assert.equal(dynamicUrlFor(dynId), `${getPublicBaseUrl()}/r/${dynId}`);
assert.equal(shortUrlFor({ id: dynId, slug: dynSlug }), dynShortUrl);
ok("shortUrlFor and dynamicUrlFor generate configured TypQR /r/:slug canonical short URLs");

// 2.4 Verify QR Payload encoding: Dynamic QR encodes TypQR short URL, not original destination
const qrEncodedPayload = shortUrlFor(docData);
assert.equal(qrEncodedPayload, dynShortUrl);
assert.notEqual(qrEncodedPayload, "https://shop.example.com/summer-sale");
ok("Dynamic QR image encodes TypQR short URL into QR image, NOT original destination");

// 2.5 Slug collision handling
// Pre-populate a document with slug "collide123"
await db.collection("links").doc("existing_doc").set({
  slug: "collide123",
  destination: "https://existing.com",
  kind: "redirect",
});

let collisionAttempt = 0;
const collisionGenerator = () => {
  collisionAttempt++;
  return collisionAttempt === 1 ? "collide123" : "resolvedClean456";
};

const collisionApi = createLinksHandler({
  getDb: () => db,
  verify: mockVerify,
  serverTs: () => "TS",
  now: () => Date.now(),
  newId: collisionGenerator,
});

const retryRes = await callJson(collisionApi, {
  method: "POST",
  headers: authCustomer,
  query: { action: "create" },
  body: {
    link: {
      kind: "redirect",
      type: "url",
      label: "Collision Test",
      destination: "https://retry.example.com",
    },
  },
});

assert.equal(retryRes.code, 200);
assert.equal(retryRes.body.slug, "resolvedClean456");
ok("Slug collision detected and resolved cleanly via automatic retry");

// 2.6 /r/:slug Redirect Handler Execution
let scansLogged = [];
const redirectHandler = createHandler({
  getDb: () => db,
  secret: () => "test-cookie-secret",
  increment: (n) => ({ __inc: n }),
  serverTs: () => "TS_NOW",
  quota: {
    check: async () => ({ ok: true }),
    record: async () => {},
  },
});

function callRedirect(path, id) {
  return new Promise(async (resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      body: "",
      setHeader(k, v) { this.headers[k] = v; },
      end(b) { this.body = b || ""; resolve(this); },
    };
    await redirectHandler({
      method: "GET",
      url: `${path}/${id}`,
      headers: {
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/604",
        "x-vercel-ip-country": "IN",
        "x-vercel-ip-city": "Mumbai",
      },
      query: { id },
    }, res);
  });
}

// Redirect through /r/:slug
let redirRes = await callRedirect("/r", dynSlug);
assert.equal(redirRes.statusCode, 302);
assert.equal(redirRes.headers.Location, "https://shop.example.com/summer-sale");
ok("GET /r/:slug resolves from DB and returns 302 redirect to saved destination");

// Verify scan tracking and analytics logging
const updatedDoc = (await db.collection("links").doc(dynId).get()).data();
assert.equal(updatedDoc.scans, 1);
ok("Scan counter incremented in persistent storage on /r/:slug redirect");

// 2.7 Destination Editing (Over-The-Air Update)
// Owner updates destination URL to a new campaign
const updateRes = await callJson(linksApi, {
  method: "POST",
  headers: authCustomer,
  query: { action: "update" },
  body: {
    id: dynId,
    patch: {
      destination: "https://shop.example.com/autumn-black-friday",
    },
  },
});
assert.equal(updateRes.code, 200);

// Check that shortUrl and slug remain identical
const postUpdateDoc = (await db.collection("links").doc(dynId).get()).data();
assert.equal(postUpdateDoc.slug, dynSlug, "Slug must NEVER change when editing destination");
assert.equal(postUpdateDoc.shortUrl, dynShortUrl, "Short URL must NEVER change when editing destination");
assert.equal(postUpdateDoc.destination, "https://shop.example.com/autumn-black-friday");
ok("Owner edits destination: permanent slug and short URL remain 100% unchanged");

// Scan /r/:slug again -> immediately redirects to new destination!
let redirRes2 = await callRedirect("/r", dynSlug);
assert.equal(redirRes2.statusCode, 302);
assert.equal(redirRes2.headers.Location, "https://shop.example.com/autumn-black-friday");
ok("Subsequent scans to the same QR code immediately redirect to the updated destination over-the-air");

// 2.8 Unsafe Destination Schemes Protection
const unsafeDestRes = await callJson(linksApi, {
  method: "POST",
  headers: authCustomer,
  query: { action: "create" },
  body: {
    link: {
      kind: "redirect",
      destination: "javascript:alert(document.cookie)",
    },
  },
});
assert.equal(unsafeDestRes.code, 400);
ok("Creation rejects unsafe URL schemes (javascript:, data:, etc.)");

// 2.9 Static Direct QR codes: Keep working as before (No short URL, direct encoding)
const staticCreateRes = await callJson(linksApi, {
  method: "POST",
  headers: authCustomer,
  query: { action: "create" },
  body: {
    link: {
      kind: "static",
      payload: "WIFI:T:WPA;S:CoffeeShop;P:Secret123;;",
      label: "Coffee Wi-Fi",
    },
  },
});
assert.equal(staticCreateRes.code, 200);
const staticId = staticCreateRes.body.id;
assert.equal(staticCreateRes.body.shortUrl, null, "Static QRs must not have a short URL");

const staticDoc = (await db.collection("links").doc(staticId).get()).data();
assert.equal(staticDoc.kind, "static");
assert.equal(staticDoc.payload, "WIFI:T:WPA;S:CoffeeShop;P:Secret123;;");
assert.equal(staticDoc.shortUrl, null);

// Direct encoding check:
assert.equal(staticDoc.payload, "WIFI:T:WPA;S:CoffeeShop;P:Secret123;;");
// Ensure static QRs cannot be redirected through /r/:slug
const staticRedir = await callRedirect("/r", staticId);
assert.equal(staticRedir.statusCode, 404);
ok("Static Direct QR codes encode payload directly, have no short URL, and return 404 if accessed via /r/");

// 2.10 Sequential Integration: Dynamic Google Review QR
// User first resolves Google Review URL, then creates Dynamic TypQR short link for it
const resolvedReviewDestination = canonicalReview;
const reviewDynRes = await callJson(linksApi, {
  method: "POST",
  headers: authCustomer,
  query: { action: "create" },
  body: {
    link: {
      kind: "redirect",
      type: "review",
      label: "Our Google Review QR",
      destination: resolvedReviewDestination,
    },
  },
});
assert.equal(reviewDynRes.code, 200);
assert.ok(reviewDynRes.body.shortUrl);
const reviewDynRedir = await callRedirect("/r", reviewDynRes.body.slug);
assert.equal(reviewDynRedir.statusCode, 302);
assert.equal(reviewDynRedir.headers.Location, canonicalReview);
ok("Dynamic Google Review QR works sequentially: resolves review destination, then encodes TypQR short link");

console.log(`\nALL ${passed} FEATURE 1 & FEATURE 2 TESTS PASSED WITH 100% SUCCESS!\n`);
