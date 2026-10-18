// test/features_review_and_shortlinks.test.mjs
// Comprehensive test suite for:
// 1. Feature 1: ProductMate-Style Google Review Link Generator
// 2. Feature 2: Bitly-Style TypQR Short Links for Dynamic QR Codes

import assert from "node:assert/strict";
import { makeDb, callJson } from "./fakeDb.mjs";
import { createLinksHandler, getPublicBaseUrl } from "../api/_lib/links.js";
import { createHandler } from "../api/_lib/handler.js";
import {
  resolveGoogleMapsUrl,
  extractPlaceIdFromUrl,
  isValidPlaceId,
  buildGoogleReviewUrl,
  hexToPlaceId,
  isPrivateIp,
  isApprovedGoogleDomain,
  validateOfficialReviewUrl,
  extractMapsMetadata,
  lookupGooglePlacesApi,
  safeDecodeUrl,
} from "../api/_lib/googleReview.js";
import { buildPayload } from "../src/lib/qrPayloads.js";
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
assert.equal(isValidPlaceId("ChIJq3uGrhyPsUcRoqE7daOz-LY"), true);
assert.equal(isValidPlaceId("not-a-place-id"), false);
assert.equal(isValidPlaceId("https://google.com"), false);
assert.equal(isValidPlaceId(""), false);
ok("isValidPlaceId validates genuine Google Place IDs and rejects arbitrary strings");

// 1.2 Canonical Review URL Builder
const placeId1 = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const canonicalReview = buildGoogleReviewUrl(placeId1);
assert.equal(canonicalReview, `https://search.google.com/local/writereview?placeid=${placeId1}`);
ok("buildGoogleReviewUrl generates canonical write-review link format");

// 1.3 Hex Feature ID to Place ID Conversion (Mathematical Protobuf Mapping)
// Real-world sample from ProductMate:
// https://www.google.com/maps/place/PRODUCTMATE/data=!1s0x47b18f1cae867bab:0xb6f8b3a3753ba1a2!8m2
const productMatePlaceId = hexToPlaceId("0x47b18f1cae867bab", "0xb6f8b3a3753ba1a2");
assert.equal(productMatePlaceId, "ChIJq3uGrhyPsUcRoqE7daOz-LY");
ok("hexToPlaceId converts Google feature ID hex pairs (0x...:0x...) into verified Place ID");

// Second sample: Sydney Opera House (0x6b12ae665e892fdd:0x9bb1ec898169c451)
const operaHousePlaceId = hexToPlaceId("0x6b12ae665e892fdd", "0x9bb1ec898169c451");
assert.equal(operaHousePlaceId, "ChIJ3S-JXmauEmsRUcRpgYnssZs");
ok("hexToPlaceId verified against Sydney Opera House feature ID");

// 1.4 Place ID Extraction from various Google Maps formats
// Format A: Direct Place ID
assert.equal(extractPlaceIdFromUrl(placeId1), placeId1);

// Format B: placeid / place_id query parameter
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

// Format D: Full Google Maps URL with !1s0x...:0x... feature ID
const fullMapsUrl =
  "https://www.google.com/maps/place/PRODUCTMATE/data=!1s0x47b18f1cae867bab:0xb6f8b3a3753ba1a2!8m2!3d52.52!4d13.40";
assert.equal(extractPlaceIdFromUrl(fullMapsUrl), "ChIJq3uGrhyPsUcRoqE7daOz-LY");
ok("extractPlaceIdFromUrl extracts Place IDs from full Google Maps place URLs containing !1s0x...:0x...");

// Format E: Google redirect URL unwrapping (?q=https://...)
const redirectTrampoline =
  "https://www.google.com/url?q=https://www.google.com/maps/place/PRODUCTMATE/data=!1s0x47b18f1cae867bab:0xb6f8b3a3753ba1a2!8m2";
assert.equal(extractPlaceIdFromUrl(redirectTrampoline), "ChIJq3uGrhyPsUcRoqE7daOz-LY");
ok("extractPlaceIdFromUrl unwraps Google redirect trampolines");

// 1.5 Short Link Resolution with Network Mock
const safeDnsLookup = async (hostname) => {
  return { address: "142.250.190.46", family: 4 }; // Public Google IP
};

const mockFetchShortLink = async (url) => {
  // A: maps.app.goo.gl short URL
  if (url === "https://maps.app.goo.gl/sampleShort123") {
    return {
      status: 302,
      headers: new Headers({
        location: fullMapsUrl,
      }),
    };
  }
  // B: share.google short URL
  if (url === "https://share.google/bizShort456") {
    return {
      status: 301,
      headers: new Headers({
        location: "https://www.google.com/maps/place/Sydney+Opera+House/data=!1s0x6b12ae665e892fdd:0x9bb1ec898169c451",
      }),
    };
  }
  // C: legacy goo.gl/maps short URL
  if (url === "https://goo.gl/maps/legacy789") {
    return {
      status: 301,
      headers: new Headers({
        location: fullMapsUrl,
      }),
    };
  }
  // D: Unapproved domain redirect
  if (url === "https://maps.app.goo.gl/evilRedirect") {
    return {
      status: 302,
      headers: new Headers({
        location: "https://attacker.com/steal-creds",
      }),
    };
  }
  // E: Private IP redirect
  if (url === "https://maps.app.goo.gl/privateIpRedirect") {
    return {
      status: 302,
      headers: new Headers({
        location: "https://internal-service.google.com/admin",
      }),
    };
  }
  return { status: 404, headers: new Headers() };
};

// Test maps.app.goo.gl
const shortLinkRes = await resolveGoogleMapsUrl("https://maps.app.goo.gl/sampleShort123", {
  fetchImpl: mockFetchShortLink,
  dnsLookupImpl: safeDnsLookup,
});
assert.equal(shortLinkRes.ok, true);
assert.equal(shortLinkRes.placeId, "ChIJq3uGrhyPsUcRoqE7daOz-LY");
assert.equal(shortLinkRes.place_id, "ChIJq3uGrhyPsUcRoqE7daOz-LY");
assert.equal(shortLinkRes.verification, "not_verified");
ok("resolveGoogleMapsUrl follows maps.app.goo.gl redirect and extracts Place ID");

// Test share.google
const shareGoogleRes = await resolveGoogleMapsUrl("https://share.google/bizShort456", {
  fetchImpl: mockFetchShortLink,
  dnsLookupImpl: safeDnsLookup,
});
assert.equal(shareGoogleRes.ok, true);
assert.equal(shareGoogleRes.placeId, "ChIJ3S-JXmauEmsRUcRpgYnssZs");
ok("resolveGoogleMapsUrl follows share.google redirect and extracts Place ID");

// Test legacy goo.gl/maps
const legacyGooglRes = await resolveGoogleMapsUrl("https://goo.gl/maps/legacy789", {
  fetchImpl: mockFetchShortLink,
  dnsLookupImpl: safeDnsLookup,
});
assert.equal(legacyGooglRes.ok, true);
assert.equal(legacyGooglRes.placeId, "ChIJq3uGrhyPsUcRoqE7daOz-LY");
ok("resolveGoogleMapsUrl resolves legacy goo.gl/maps links safely");

// 1.6 SSRF Security Checks
// A: Initial unapproved domain -> unsupported_url
const nonGoogleRes = await resolveGoogleMapsUrl("https://attacker.com/evil-redirect");
assert.equal(nonGoogleRes.ok, false);
assert.equal(nonGoogleRes.code, "unsupported_url");
ok("Initial non-Google domain returns code: unsupported_url");

// B: Redirect to an unapproved domain -> unsafe_redirect
const unapprovedRedirectRes = await resolveGoogleMapsUrl("https://maps.app.goo.gl/evilRedirect", {
  fetchImpl: mockFetchShortLink,
  dnsLookupImpl: safeDnsLookup,
});
assert.equal(unapprovedRedirectRes.ok, false);
assert.equal(unapprovedRedirectRes.code, "unsafe_redirect");
ok("Redirect to an unapproved domain is blocked with code: unsafe_redirect");

// C: Redirect resolving to a private/internal IP (127.0.0.1, 169.254.169.254, 10.x, 192.168.x) -> unsafe_redirect
const privateDnsLookup = async () => ({ address: "169.254.169.254", family: 4 });
const privateIpRes = await resolveGoogleMapsUrl("https://maps.app.goo.gl/privateIpRedirect", {
  fetchImpl: mockFetchShortLink,
  dnsLookupImpl: privateDnsLookup,
});
assert.equal(privateIpRes.ok, false);
assert.equal(privateIpRes.code, "unsafe_redirect");
ok("Redirect resolving to internal/cloud metadata IP (169.254.169.254) is blocked with code: unsafe_redirect");

// D: Private IP helper unit tests
assert.equal(isPrivateIp("127.0.0.1"), true);
assert.equal(isPrivateIp("192.168.1.100"), true);
assert.equal(isPrivateIp("10.0.0.1"), true);
assert.equal(isPrivateIp("172.16.0.1"), true);
assert.equal(isPrivateIp("::1"), true);
assert.equal(isPrivateIp("142.250.190.46"), false);
ok("isPrivateIp rejects loopback, RFC1918, link-local and allows public routable IPs");

// 1.7 Timeout Handling -> upstream_timeout
const timeoutFetch = async () => {
  const err = new Error("Aborted");
  err.name = "AbortError";
  throw err;
};
const timeoutRes = await resolveGoogleMapsUrl("https://maps.app.goo.gl/sampleShort123", {
  fetchImpl: timeoutFetch,
  dnsLookupImpl: safeDnsLookup,
  timeoutMs: 100,
});
assert.equal(timeoutRes.ok, false);
assert.equal(timeoutRes.code, "upstream_timeout");
ok("Resolution timeout returns code: upstream_timeout");

// 1.8 Google Maps URL with no extractable Place ID -> place_id_not_found
const noPlaceIdFetch = async () => ({
  status: 200,
  url: "https://www.google.com/maps/@28.6139,77.2090,12z", // Generic map view, no business
  headers: new Headers(),
});
const noPlaceRes = await resolveGoogleMapsUrl("https://www.google.com/maps/@28.6139,77.2090,12z", {
  fetchImpl: noPlaceIdFetch,
  dnsLookupImpl: safeDnsLookup,
});
assert.equal(noPlaceRes.ok, false);
assert.equal(noPlaceRes.code, "place_id_not_found");
ok("Google Maps link with no specific place identifier returns code: place_id_not_found");

// 1.9 QR Payload builder for review type (manual fallback & auto)
const payloadWithPlaceId = buildPayload("review", { placeId: placeId1 });
assert.equal(payloadWithPlaceId, canonicalReview);

const payloadWithReviewUrl = buildPayload("review", { reviewUrl: canonicalReview });
assert.equal(payloadWithReviewUrl, canonicalReview);

const payloadWithManualLink = buildPayload("review", { placeId: "https://g.page/r/sample/review" });
assert.equal(payloadWithManualLink, "https://g.page/r/sample/review");
ok("buildPayload('review') encodes canonical review URL, direct reviewUrl, or official manual link");

// 1.10 Public API Endpoint (No Authentication Required)
const fakeDbInstance = makeDb();
const linksHandler = createLinksHandler({
  getDb: () => fakeDbInstance,
  verify: async () => ({ uid: "u1" }),
  serverTs: () => "TS",
  now: () => Date.now(),
  adminUids: ["admin1"],
});

// Test POST /api/links?action=resolve-google-review (with maps_url param matching ProductMate)
let apiReviewRes = await callJson(linksHandler, {
  method: "POST",
  query: { action: "resolve-google-review" },
  body: { maps_url: fullMapsUrl },
});
assert.equal(apiReviewRes.code, 200);
assert.equal(apiReviewRes.body.ok, true);
assert.equal(apiReviewRes.body.place_id, "ChIJq3uGrhyPsUcRoqE7daOz-LY");
assert.equal(apiReviewRes.body.review_url, "https://search.google.com/local/writereview?placeid=ChIJq3uGrhyPsUcRoqE7daOz-LY");
ok("POST /api/links?action=resolve-google-review resolves full maps_url publicly without authentication");

// Test Real-World Business URL Integration:
// Google Maps place URL for Eiffel Tower:
const eiffelTowerMapsUrl =
  "https://www.google.com/maps/place/Eiffel+Tower/data=!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0";
const eiffelPlaceId = extractPlaceIdFromUrl(eiffelTowerMapsUrl);
assert.equal(eiffelPlaceId, "ChIJLU7jZClu5kcR4PcOOO6p3I0");
const eiffelReviewUrl = buildGoogleReviewUrl(eiffelPlaceId);
assert.equal(eiffelReviewUrl, "https://search.google.com/local/writereview?placeid=ChIJLU7jZClu5kcR4PcOOO6p3I0");
ok("Real-world business (Eiffel Tower) correctly resolves to Place ID ChIJLU7jZClu5kcR4PcOOO6p3I0");

// Real-world business URL for Sydney Opera House:
const sydneyOperaMapsUrl =
  "https://www.google.com/maps/place/Sydney+Opera+House/@-33.8567844,151.2152967,17z/data=!4m6!3m5!1s0x6b12ae665e892fdd:0x3133f8d75a1ac251!8m2!3d-33.8567844!4d151.2152967!16zL20vMDZfbm0";
const sydneyPlaceId = extractPlaceIdFromUrl(sydneyOperaMapsUrl);
assert.equal(sydneyPlaceId, "ChIJ3S-JXmauEmsRUcIaWtf4MzE");
const sydneyReviewUrl = buildGoogleReviewUrl(sydneyPlaceId);
assert.equal(sydneyReviewUrl, "https://search.google.com/local/writereview?placeid=ChIJ3S-JXmauEmsRUcIaWtf4MzE");
ok("Real-world business (Sydney Opera House) correctly resolves to Place ID ChIJ3S-JXmauEmsRUcIaWtf4MzE");

// 1.11 Regression Test: query_place_id parameter format
const queryPlaceIdUrl = "https://www.google.com/maps/search/?api=1&query=Centennial+Park&query_place_id=ChIJ5xL0AeqxEmsRkQ4qI_6fW6I";
const extractedQueryPlaceId = extractPlaceIdFromUrl(queryPlaceIdUrl);
assert.equal(extractedQueryPlaceId, "ChIJ5xL0AeqxEmsRkQ4qI_6fW6I");
ok("extractPlaceIdFromUrl extracts Place ID from query_place_id parameter");

// 1.12 Regression Test: q=place_id: format
const qPlaceIdUrl = "https://maps.google.com/?q=place_id:ChIJq3uGrhyPsUcRoqE7daOz-LY";
const extractedQPlaceId = extractPlaceIdFromUrl(qPlaceIdUrl);
assert.equal(extractedQPlaceId, "ChIJq3uGrhyPsUcRoqE7daOz-LY");
ok("extractPlaceIdFromUrl extracts Place ID from q=place_id: format");

// 1.13 Regression Test: Place ID directly in /maps/place/ path
const pathPlaceIdUrl = "https://www.google.com/maps/place/ChIJLU7jZClu5kcR4PcOOO6p3I0/@48.8583701,2.2944813,17z";
const extractedPathPlaceId = extractPlaceIdFromUrl(pathPlaceIdUrl);
assert.equal(extractedPathPlaceId, "ChIJLU7jZClu5kcR4PcOOO6p3I0");
ok("extractPlaceIdFromUrl extracts Place ID directly from /maps/place/ path");

// 1.14 Regression Test: URL-encoded data parameter (%211s0x...%3A0x...)
const encodedDataUrl = "https://www.google.com/maps/place/Eiffel+Tower/data=%211s0x47e66e2964e34e2d%3A0x8ddca9ee380ef7e0";
const extractedEncodedPlaceId = extractPlaceIdFromUrl(encodedDataUrl);
assert.equal(extractedEncodedPlaceId, "ChIJLU7jZClu5kcR4PcOOO6p3I0");
ok("extractPlaceIdFromUrl decodes URL-encoded data parameter (%211s...%3A...) and derives Place ID");

// 1.15 Regression Test: Missing Place ID (business name only, no place id or hex pair)
// Must NEVER fabricate a Place ID or report unverified place as verified
const nameOnlyUrl = "https://www.google.com/maps/place/The+Coffee+Shop/@40.7128,-74.0060,15z";
const metaFromName = extractMapsMetadata(nameOnlyUrl);
assert.equal(metaFromName.businessName, "The Coffee Shop");
assert.equal(metaFromName.coordinates.lat, 40.7128);
const nameOnlyRes = await resolveGoogleMapsUrl(nameOnlyUrl, {
  dnsLookupImpl: safeDnsLookup,
});
assert.equal(nameOnlyRes.ok, false);
assert.equal(nameOnlyRes.code, "place_id_not_found");
assert.equal(nameOnlyRes.diagnostics.businessName, "The Coffee Shop");
ok("URL with only a business name returns place_id_not_found without fabricating a Place ID");

// 1.16 Regression Test: CID only URL (CID is not automatically a Place ID)
const cidOnlyUrl = "https://maps.google.com/?cid=10222452814328887264";
const metaFromCid = extractMapsMetadata(cidOnlyUrl);
assert.equal(metaFromCid.cid, "10222452814328887264");
const cidOnlyRes = await resolveGoogleMapsUrl(cidOnlyUrl, {
  dnsLookupImpl: safeDnsLookup,
});
assert.equal(cidOnlyRes.ok, false);
assert.equal(cidOnlyRes.code, "place_id_not_found");
assert.equal(cidOnlyRes.diagnostics.cid, "10222452814328887264");
ok("URL with CID only returns place_id_not_found and does not treat CID as a Place ID");

// 1.17 Regression Test: Optional Google Places API Lookup Fallback (Mock Success)
const mockPlacesApiFetch = async (url) => {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: "OK",
      candidates: [
        {
          place_id: "ChIJ3S-JXmauEmsRUcIaWtf4MzE",
          name: "Sydney Opera House",
          formatted_address: "Bennelong Point, Sydney NSW 2000, Australia",
        },
      ],
    }),
  };
};
const placesApiRes = await resolveGoogleMapsUrl("https://www.google.com/maps/place/Sydney+Opera+House/@-33.8567844,151.2152967,17z", {
  dnsLookupImpl: safeDnsLookup,
  placesApiKey: "mock_test_key_12345",
  fetchImpl: mockPlacesApiFetch,
});
assert.equal(placesApiRes.ok, true);
assert.equal(placesApiRes.place_id, "ChIJ3S-JXmauEmsRUcIaWtf4MzE");
assert.equal(placesApiRes.source, "google_places_api");
assert.equal(placesApiRes.review_url, "https://search.google.com/local/writereview?placeid=ChIJ3S-JXmauEmsRUcIaWtf4MzE");
ok("Optional Google Places API lookup fallback resolves business name to verified Place ID");

// 1.18 Regression Test: Google Places API Quota / Error Handling (Safe Handling)
const mockPlacesQuotaFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    status: "OVER_QUERY_LIMIT",
    error_message: "You have exceeded your request quota for this API.",
  }),
});
const placesQuotaRes = await resolveGoogleMapsUrl("https://www.google.com/maps/place/Sydney+Opera+House/@-33.8567844,151.2152967,17z", {
  dnsLookupImpl: safeDnsLookup,
  placesApiKey: "mock_test_key_12345",
  fetchImpl: mockPlacesQuotaFetch,
});
assert.equal(placesQuotaRes.ok, false);
assert.equal(placesQuotaRes.code, "places_quota_exceeded");
ok("Google Places API OVER_QUERY_LIMIT quota error returns code: places_quota_exceeded");

// 1.18b Regression Test: Google Places API Invalid Key Handling
const mockPlacesInvalidKeyFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    status: "REQUEST_DENIED",
    error_message: "The provided API key is invalid.",
  }),
});
const placesInvalidKeyRes = await resolveGoogleMapsUrl("https://www.google.com/maps/place/Sydney+Opera+House/@-33.8567844,151.2152967,17z", {
  dnsLookupImpl: safeDnsLookup,
  placesApiKey: "invalid_key_xyz",
  fetchImpl: mockPlacesInvalidKeyFetch,
});
assert.equal(placesInvalidKeyRes.ok, false);
assert.equal(placesInvalidKeyRes.code, "invalid_api_key");
ok("Google Places API REQUEST_DENIED returns code: invalid_api_key without leaking secret");

// 1.18c Regression Test: Google Places API No Match (ZERO_RESULTS)
const mockPlacesZeroResultsFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    status: "ZERO_RESULTS",
    candidates: [],
  }),
});
const placesZeroRes = await resolveGoogleMapsUrl("https://www.google.com/maps/place/NonExistentBiz123XYZ/@0,0,1z", {
  dnsLookupImpl: safeDnsLookup,
  placesApiKey: "mock_test_key_12345",
  fetchImpl: mockPlacesZeroResultsFetch,
});
assert.equal(placesZeroRes.ok, false);
assert.equal(placesZeroRes.code, "no_match");
ok("Google Places API ZERO_RESULTS returns code: no_match");

// 1.18d Regression Test: Google Places API Multiple Matches (Disambiguation required)
const mockPlacesMultipleMatchesFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    status: "OK",
    candidates: [
      {
        place_id: "ChIJ_branch_delhi_1234567890",
        name: "Graphix Circle - Delhi",
        formatted_address: "123 Connaught Place, New Delhi",
      },
      {
        place_id: "ChIJ_branch_mumbai_123456789",
        name: "Graphix Circle - Mumbai",
        formatted_address: "456 Bandra West, Mumbai",
      },
    ],
  }),
});
const placesMultiRes = await resolveGoogleMapsUrl("https://www.google.com/maps/place/Graphix+Circle/@0,0,1z", {
  dnsLookupImpl: safeDnsLookup,
  placesApiKey: "mock_test_key_12345",
  fetchImpl: mockPlacesMultipleMatchesFetch,
});
assert.equal(placesMultiRes.ok, false);
assert.equal(placesMultiRes.code, "multiple_matches");
assert.equal(placesMultiRes.candidates.length, 2);
assert.equal(placesMultiRes.candidates[0].place_id, "ChIJ_branch_delhi_1234567890");
assert.equal(placesMultiRes.candidates[1].place_id, "ChIJ_branch_mumbai_123456789");
ok("Google Places API multiple matches returns code: multiple_matches with candidate list for user selection");

// 1.18e Regression Test: Places API (New) Text Search Support (POST places:searchText)
const mockPlacesNewApiFetch = async (url, opts) => {
  if (url.includes("places:searchText")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        places: [
          {
            id: "ChIJ_places_new_api_verified_id",
            displayName: { text: "Graphix Circle" },
            formattedAddress: "789 Creative Lane, Design City",
          },
        ],
      }),
    };
  }
  return { ok: false, status: 404 };
};
const placesNewApiRes = await resolveGoogleMapsUrl("https://www.google.com/maps/place/Graphix+Circle/@0,0,1z", {
  dnsLookupImpl: safeDnsLookup,
  placesApiKey: "mock_new_places_api_key",
  fetchImpl: mockPlacesNewApiFetch,
});
assert.equal(placesNewApiRes.ok, true);
assert.equal(placesNewApiRes.place_id, "ChIJ_places_new_api_verified_id");
assert.equal(placesNewApiRes.business_name, "Graphix Circle");
assert.equal(placesNewApiRes.address, "789 Creative Lane, Design City");
ok("Places API (New) POST places:searchText is supported and verified");

// 1.19 Regression Test: Official Google Review URL Pasted Directly
const officialWritereviewUrl = "https://search.google.com/local/writereview?placeid=ChIJq3uGrhyPsUcRoqE7daOz-LY";
const directReviewRes = await resolveGoogleMapsUrl(officialWritereviewUrl);
assert.equal(directReviewRes.ok, true);
assert.equal(directReviewRes.place_id, "ChIJq3uGrhyPsUcRoqE7daOz-LY");
assert.equal(directReviewRes.review_url, officialWritereviewUrl);
ok("Official Google review URL pasted directly is validated and accepted immediately");

// 1.20 Regression Test: Official Google Review Short Link (g.page/r/.../review)
const gPageReviewUrl = "https://g.page/r/CbW7uL-Y5_3vEAE/review";
const gPageReviewCheck = validateOfficialReviewUrl(gPageReviewUrl);
assert.equal(gPageReviewCheck.valid, true);
assert.equal(gPageReviewCheck.type, "g_page_review");
const gPageRes = await resolveGoogleMapsUrl(gPageReviewUrl, {
  dnsLookupImpl: safeDnsLookup,
});
assert.equal(gPageRes.ok, true);
assert.equal(gPageRes.source, "official_review_url");
ok("Official Google review short URL (g.page/r/.../review) is validated and accepted");

// 1.21 Regression Test: Unapproved review domain rejected
const unapprovedReviewRes = await resolveGoogleMapsUrl("https://attacker.com/local/writereview?placeid=ChIJq3uGrhyPsUcRoqE7daOz-LY");
assert.equal(unapprovedReviewRes.ok, false);
assert.equal(unapprovedReviewRes.code, "unsupported_url");
ok("Unapproved review URL domain is rejected with code unsupported_url");

// 1.22 Regression Test: Controlled redirect fixture reproducing share.google multi-hop behavior
const mockShareGoogleFetch = async (url) => {
  if (url === "https://share.google/controlledTest123") {
    return {
      status: 302,
      headers: new Headers({ location: "https://www.google.com/share.google?q=controlledTest123" }),
    };
  }
  if (url === "https://www.google.com/share.google?q=controlledTest123") {
    return {
      status: 301,
      headers: new Headers({
        location: "https://www.google.com/search?kgmid=/g/11xt4mq0gn&q=Dynamic+Test+Business&kgs=e7811dbdf658aff3",
      }),
    };
  }
  if (url.startsWith("https://www.google.com/search?")) {
    return {
      status: 200,
      headers: new Headers(),
    };
  }
  if (url.includes("maps.googleapis.com")) {
    const urlObj = new URL(url);
    const inputQuery = urlObj.searchParams.get("input");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: "OK",
        candidates: [
          {
            place_id: "ChIJ_dynamic_verified_place_id",
            name: inputQuery,
            formatted_address: "123 Business Way, Test City",
          },
        ],
      }),
    };
  }
  throw new Error(`Unexpected fetch URL in test: ${url}`);
};

// Test A: Without Places API key configured (default)
const controlledResWithoutKey = await resolveGoogleMapsUrl("https://share.google/controlledTest123", {
  dnsLookupImpl: safeDnsLookup,
  fetchImpl: mockShareGoogleFetch,
});
assert.equal(controlledResWithoutKey.ok, false);
assert.equal(controlledResWithoutKey.code, "place_id_not_found");
assert.equal(controlledResWithoutKey.business_name, "Dynamic Test Business");
assert.equal(controlledResWithoutKey.diagnostics.kgmid, "/g/11xt4mq0gn");
assert.equal(controlledResWithoutKey.diagnostics.kgs, "e7811dbdf658aff3");
assert.equal(controlledResWithoutKey.diagnostics.placesApiConfigured, false);
assert.equal(controlledResWithoutKey.diagnostics.hops, 2);
ok("share.google multi-hop fixture resolves complete chain and extracts business name without fabricating Place ID");

// Test B: With server-side Places API key configured
const controlledResWithKey = await resolveGoogleMapsUrl("https://share.google/controlledTest123", {
  dnsLookupImpl: safeDnsLookup,
  fetchImpl: mockShareGoogleFetch,
  placesApiKey: "mock_server_places_api_key",
});
assert.equal(controlledResWithKey.ok, true);
assert.equal(controlledResWithKey.source, "google_places_api");
assert.equal(controlledResWithKey.business_name, "Dynamic Test Business");
assert.equal(controlledResWithKey.place_id, "ChIJ_dynamic_verified_place_id");
assert.equal(controlledResWithKey.review_url, "https://search.google.com/local/writereview?placeid=ChIJ_dynamic_verified_place_id");
ok("share.google multi-hop fixture seamlessly triggers Google Places API fallback when API key is provided");

// 1.23 Regression Test: Live exact URL resolution pipeline test
const exactUrlLiveRes = await resolveGoogleMapsUrl("https://share.google/MfygMxeCrhahq4kAq");
assert.equal(exactUrlLiveRes.business_name, "Graphix Circle");
assert.equal(exactUrlLiveRes.diagnostics.kgmid, "/g/11xt4mq0gn");
assert.equal(exactUrlLiveRes.diagnostics.hops, 2);
assert.ok(exactUrlLiveRes.resolved_url.includes("Graphix+Circle"));
ok("Exact failing URL (https://share.google/MfygMxeCrhahq4kAq) resolves live through all hops to Graphix Circle");


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
process.exit(0);
