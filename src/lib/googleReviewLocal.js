// src/lib/googleReviewLocal.js — Pure Local Google Review Link & Place ID Helpers
// Zero external APIs: no Google Places API, no Google Maps API, no web scraping.

const PLACE_ID_REGEX = /^[A-Za-z0-9_\-]{20,120}$/;

export function extractPlaceIdLocally(input) {
  if (!input) return null;
  const str = String(input).trim();

  // 1. Direct Place ID
  if (PLACE_ID_REGEX.test(str) && !str.includes("/") && !str.includes(".")) {
    return str;
  }

  // 2. Query param: placeid or place_id or query_place_id
  const qMatch = str.match(/[?&](?:placeid|place_id|query_place_id)=([A-Za-z0-9_\-]+)/i);
  if (qMatch && qMatch[1]) {
    return qMatch[1];
  }

  // 3. /maps/place/.../data=... where !1s(ChIJ...) is present
  const dataMatch = str.match(/!1s(ChIJ[A-Za-z0-9_\-]+)/i);
  if (dataMatch && dataMatch[1]) {
    return dataMatch[1];
  }

  // 4. /maps/place/ChIJ...
  const chijMatch = str.match(/\/maps\/place\/(ChIJ[A-Za-z0-9_\-]+)/i);
  if (chijMatch && chijMatch[1]) {
    return chijMatch[1];
  }

  // 5. Hex pair pattern in data: 0x...:0x... (CID, not standard place ID string)
  return null;
}

export function isValidGoogleReviewUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === "search.google.com" && u.pathname.includes("/local/writereview")) {
      return true;
    }
    if (host === "g.page" && u.pathname.includes("/review")) {
      return true;
    }
    if (host.endsWith(".google.com") && u.searchParams.has("placeid")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function isValidGoogleMapsUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const isGoogleHost =
      host === "maps.google.com" ||
      host.endsWith(".google.com") ||
      host === "google.com" ||
      host === "maps.app.goo.gl" ||
      host === "goo.gl" ||
      host === "share.google" ||
      host.endsWith(".google");

    if (!isGoogleHost) return false;
    return (
      u.pathname.includes("/maps") ||
      host.includes("maps") ||
      host === "share.google" ||
      u.searchParams.has("q") ||
      u.searchParams.has("query")
    );
  } catch {
    return false;
  }
}
