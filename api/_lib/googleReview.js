// api/_lib/googleReview.js
// Safe extraction and resolution for Google Maps URLs and Google Review link generation.
// Direct Google review format: https://search.google.com/local/writereview?placeid=PLACE_ID

import net from "node:net";
import dns from "node:dns";

const PLACE_ID_REGEX = /^[A-Za-z0-9_-]{20,80}$/;

/**
 * Checks if an IP string is a private, loopback, link-local, or reserved address (SSRF guard).
 */
export function isPrivateIp(ip) {
  if (!ip || typeof ip !== "string") return true;

  // IPv4 validation
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return true;
    // 0.0.0.0/8 (current network)
    if (parts[0] === 0) return true;
    // 10.0.0.0/8 (private)
    if (parts[0] === 10) return true;
    // 127.0.0.0/8 (loopback)
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (link-local / AWS metadata)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 172.16.0.0/12 (private: 172.16.0.0 - 172.31.255.255)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16 (private)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 255.255.255.255 (broadcast)
    if (parts.every((p) => p === 255)) return true;
    return false;
  }

  // IPv6 validation
  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase();
    // ::1 loopback
    if (norm === "::1" || norm === "0:0:0:0:0:0:0:1" || norm === "::") return true;
    // fc00::/7 (unique local)
    if (norm.startsWith("fc") || norm.startsWith("fd")) return true;
    // fe80::/10 (link local)
    if (/^fe[89ab]/i.test(norm)) return true;
    // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:192.168.1.1)
    if (norm.includes("::ffff:")) {
      const v4Part = norm.split("::ffff:")[1];
      if (v4Part && net.isIPv4(v4Part)) return isPrivateIp(v4Part);
    }
    return false;
  }

  return true;
}

/**
 * Checks if a hostname belongs to an approved Google domain or Google short link service.
 */
export function isApprovedGoogleDomain(hostname) {
  if (!hostname || typeof hostname !== "string") return false;
  const h = hostname.toLowerCase();

  // Known Google short link services and dedicated domains
  if (
    h === "maps.app.goo.gl" ||
    h === "goo.gl" ||
    h === "share.google" ||
    h === "g.page" ||
    h.endsWith(".g.page") ||
    h.endsWith(".share.google")
  ) {
    return true;
  }

  // Google Maps / Search hosts
  if (
    h === "maps.google.com" ||
    h === "search.google.com" ||
    h === "google.com" ||
    h.endsWith(".google.com")
  ) {
    return true;
  }

  // Google country code domains (e.g. google.co.in, google.co.uk, google.de, google.fr, etc.)
  if (/^(?:[a-z0-9-]+\.)*google\.(?:[a-z]{2,4}|co\.[a-z]{2}|com\.[a-z]{2})$/i.test(h)) {
    return true;
  }

  return false;
}

/**
 * Checks if a string looks like a valid Google Place ID.
 */
export function isValidPlaceId(str) {
  if (!str || typeof str !== "string") return false;
  const s = str.trim();
  if (/^ChI[A-Za-z0-9_-]{24,}$/.test(s) || /^GhI[A-Za-z0-9_-]{24,}$/.test(s)) return true;
  return PLACE_ID_REGEX.test(s) && !s.includes("/") && !s.includes(".") && !s.includes(":");
}

/**
 * Converts Google feature ID hex pair (0x<hex1>:0x<hex2>) into a canonical Google Place ID (ChIJ...).
 * Google Place IDs are protobuf messages:
 *   tag 1 (length delimited, 18 bytes):
 *     tag 1 (fixed64): 8 bytes little-endian of hex1
 *     tag 2 (fixed64): 8 bytes little-endian of hex2
 * Serialized bytes: [0x0a, 0x12, 0x09, ...hex1LE, 0x11, ...hex2LE] -> base64url.
 */
export function hexToPlaceId(hex1, hex2) {
  try {
    const clean1 = String(hex1).trim().replace(/^0x/i, "").padStart(16, "0");
    const clean2 = String(hex2).trim().replace(/^0x/i, "").padStart(16, "0");
    if (!/^[0-9a-fA-F]{16}$/.test(clean1) || !/^[0-9a-fA-F]{16}$/.test(clean2)) {
      return null;
    }
    const b1 = Buffer.from(clean1, "hex").reverse();
    const b2 = Buffer.from(clean2, "hex").reverse();
    const buf = Buffer.concat([
      Buffer.from([0x0a, 0x12, 0x09]),
      b1,
      Buffer.from([0x11]),
      b2,
    ]);
    const placeId = buf.toString("base64url");
    return isValidPlaceId(placeId) ? placeId : null;
  } catch {
    return null;
  }
}

/**
 * Build the canonical Google review URL from a verified Place ID.
 */
export function buildGoogleReviewUrl(placeId) {
  const clean = String(placeId || "").trim();
  if (!clean) return "";
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(clean)}`;
}

/**
 * Unwraps URL redirection parameters like ?q=... or ?continue=...
 */
export function unwrapNestedUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const qParam = parsed.searchParams.get("q") || parsed.searchParams.get("continue") || parsed.searchParams.get("url");
    if (qParam && /^https?:\/\//i.test(qParam)) {
      return qParam;
    }
  } catch {}
  return urlStr;
}

/**
 * Recursively decodes percent-encoded URI strings safely without throwing on malformed inputs.
 */
export function safeDecodeUrl(str) {
  if (!str || typeof str !== "string") return "";
  let decoded = str;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

/**
 * Extracts business metadata (name, CID, coordinates) from a Google Maps URL.
 * Note: A business name or CID is not automatically a Place ID.
 */
export function extractMapsMetadata(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const decoded = safeDecodeUrl(rawUrl.trim());

  let businessName = null;
  let cid = null;
  let kgmid = null;
  let kgs = null;
  let coordinates = null;

  try {
    const parsed = new URL(decoded.startsWith("http") ? decoded : `https://${decoded}`);

    // Check CID in query parameters (e.g. ?cid=10222452814328887264 or ?cid=0x...)
    const qCid = parsed.searchParams.get("cid");
    if (qCid) {
      cid = qCid.trim();
    }

    // Check kgmid (/g/...) and kgs in Google Knowledge Graph / Search URLs
    const qKgmid = parsed.searchParams.get("kgmid");
    if (qKgmid) {
      kgmid = qKgmid.trim();
    }
    const qKgs = parsed.searchParams.get("kgs");
    if (qKgs) {
      kgs = qKgs.trim();
    }

    // Check business name in /maps/place/<name>/ path
    const placeMatch = parsed.pathname.match(/\/maps\/place\/([^/@?]+)/i);
    if (placeMatch) {
      const segment = decodeURIComponent(placeMatch[1].replace(/\+/g, " ")).trim();
      // Ensure the segment is NOT a Place ID (ChI... / GhI...) or a hex pair
      if (!/^(?:ChI|GhI)[A-Za-z0-9_-]{24,}$/i.test(segment) && !/^(?:0x)?[0-9a-fA-F]{10,16}:(?:0x)?[0-9a-fA-F]{10,16}$/.test(segment)) {
        businessName = segment;
      }
    }

    // Check business name in query parameters (?q=... or ?query=...)
    if (!businessName) {
      const qVal = parsed.searchParams.get("q") || parsed.searchParams.get("query");
      if (qVal) {
        const cleanVal = decodeURIComponent(qVal.replace(/\+/g, " ")).trim();
        if (
          !isValidPlaceId(cleanVal) &&
          !cleanVal.startsWith("place_id:") &&
          !cleanVal.startsWith("0x") &&
          !/^@?-?\d+\.\d+/.test(cleanVal) &&
          cleanVal.length >= 2
        ) {
          businessName = cleanVal;
        }
      }
    }

    // Check coordinates (@lat,lng)
    const coordMatch = decoded.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (coordMatch) {
      coordinates = {
        lat: parseFloat(coordMatch[1]),
        lng: parseFloat(coordMatch[2]),
      };
    }
  } catch {}

  return { businessName, cid, kgmid, kgs, coordinates };
}

/**
 * Validates whether a URL is an official Google review destination or direct link.
 * Validates domain and format to ensure safe destinations.
 */
export function validateOfficialReviewUrl(urlStr) {
  if (!urlStr || typeof urlStr !== "string") return { valid: false, error: "Empty URL" };
  const str = urlStr.trim();
  let parsed;
  try {
    parsed = new URL(str.startsWith("http") ? str : `https://${str}`);
  } catch {
    return { valid: false, error: "Malformed URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, error: "Only http and https protocols are supported" };
  }

  if (!isApprovedGoogleDomain(parsed.hostname)) {
    return { valid: false, error: "Domain is not an approved Google review domain" };
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();

  // 1. search.google.com/local/writereview?placeid=... or /local/reviews?placeid=...
  if (
    (hostname === "search.google.com" || hostname.endsWith(".google.com")) &&
    (pathname.includes("/local/writereview") || pathname.includes("/local/reviews"))
  ) {
    const placeId = parsed.searchParams.get("placeid") || parsed.searchParams.get("place_id");
    if (isValidPlaceId(placeId)) {
      return {
        valid: true,
        type: "canonical_review",
        placeId: placeId.trim(),
        url: buildGoogleReviewUrl(placeId.trim()),
      };
    }
  }

  // 2. g.page/r/<slug>/review or g.page/r/<slug>
  if (hostname === "g.page" || hostname.endsWith(".g.page")) {
    if (/^\/r\/[A-Za-z0-9_-]+(?:\/review)?\/?$/i.test(parsed.pathname) || /^\/[A-Za-z0-9_-]+\/review\/?$/i.test(parsed.pathname)) {
      return {
        valid: true,
        type: "g_page_review",
        url: parsed.toString(),
      };
    }
  }

  // 3. google.com with placeid or query_place_id query param
  const pId = parsed.searchParams.get("query_place_id") || parsed.searchParams.get("place_id") || parsed.searchParams.get("placeid");
  if (isValidPlaceId(pId)) {
    return {
      valid: true,
      type: "place_id_url",
      placeId: pId.trim(),
      url: buildGoogleReviewUrl(pId.trim()),
    };
  }

  return { valid: false, error: "URL does not match a recognized official Google review format" };
}

export function isNameSimilar(expectedName, candidateName) {
  if (!expectedName || !candidateName) return false;
  const cleanExp = expectedName.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const cleanCand = candidateName.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleanExp || !cleanCand) return false;
  if (cleanExp === cleanCand) return true;
  if (cleanCand.includes(cleanExp) || cleanExp.includes(cleanCand)) return true;
  const expWords = cleanExp.split(" ").filter((w) => w.length > 2);
  const candWords = new Set(cleanCand.split(" ").filter((w) => w.length > 2));
  if (expWords.length === 0 || candWords.size === 0) return false;
  const matches = expWords.filter((w) => candWords.has(w));
  return matches.length === expWords.length;
}

/**
 * Server-side Google Places API lookup fallback.
 * Supports:
 *  - Places API (New): POST https://places.googleapis.com/v1/places:searchText
 *  - Places API (Legacy): GET https://maps.googleapis.com/maps/api/place/findplacefromtext/json
 * Safely handles quotas, invalid keys, no matches, confidence verification, and multiple matches.
 * The API key is kept strictly server-side and never exposed.
 */
export async function lookupGooglePlacesApi({ query, lat, lng, apiKey, fetchImpl = fetch, timeoutMs = 4000 }) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim() || !query) {
    return null;
  }

  const cleanKey = apiKey.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let candidates = [];
    let apiStatus = null;
    let errorMessage = null;
    let newApiDisabled = false;

    // 1. Try Places API (New): POST https://places.googleapis.com/v1/places:searchText
    try {
      const newApiPayload = { textQuery: query };
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        newApiPayload.locationBias = {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: 50000.0,
          },
        };
      }

      const newResp = await fetchImpl("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": cleanKey,
          "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
        },
        body: JSON.stringify(newApiPayload),
      });

      if (newResp.ok) {
        const newData = await newResp.json();
        if (Array.isArray(newData.places) && newData.places.length > 0) {
          candidates = newData.places.map((p) => ({
            place_id: p.id,
            name: p.displayName?.text || "",
            address: p.formattedAddress || "",
          }));
          apiStatus = "OK";
        } else if (Array.isArray(newData.candidates) && newData.candidates.length > 0) {
          candidates = newData.candidates.map((c) => ({
            place_id: c.place_id,
            name: c.name || "",
            address: c.formatted_address || "",
          }));
          apiStatus = "OK";
        } else if (newData.places && Array.isArray(newData.places) && newData.places.length === 0) {
          apiStatus = "ZERO_RESULTS";
        } else {
          // Response did not have places field, fall back to legacy
          newApiDisabled = true;
        }
      } else {
        const errJson = await newResp.json().catch(() => null);
        const errStatus = errJson?.error?.status || "";
        const errCode = newResp.status;
        const msg = errJson?.error?.message || "";

        if (errCode === 429 || errStatus === "RESOURCE_EXHAUSTED") {
          return {
            ok: false,
            status: "OVER_QUERY_LIMIT",
            code: "places_quota_exceeded",
            error: "Google Places API quota exceeded. Please verify your billing and quota limits in Google Cloud Console.",
          };
        }
        if (errCode === 400 && msg.toLowerCase().includes("api key not valid")) {
          return {
            ok: false,
            status: "REQUEST_DENIED",
            code: "invalid_api_key",
            error: "Google Places API key is invalid. Please verify GOOGLE_PLACES_API_KEY in Google Cloud Console.",
          };
        }
        newApiDisabled = true;
        errorMessage = msg;
      }
    } catch (newErr) {
      if (newErr?.name === "AbortError") throw newErr;
      newApiDisabled = true;
    }

    // 2. If Places API (New) returned no candidates or wasn't enabled, fallback to Legacy Places API
    if (candidates.length === 0 && (!apiStatus || newApiDisabled)) {
      let legacyUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id,name,formatted_address&key=${encodeURIComponent(cleanKey)}`;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        legacyUrl += `&locationbias=point:${lat},${lng}`;
      }

      const legacyResp = await fetchImpl(legacyUrl, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      if (legacyResp.ok) {
        const legacyData = await legacyResp.json();
        apiStatus = legacyData.status;
        errorMessage = legacyData.error_message;

        if (apiStatus === "OK" && Array.isArray(legacyData.candidates)) {
          candidates = legacyData.candidates.map((c) => ({
            place_id: c.place_id,
            name: c.name || "",
            address: c.formatted_address || "",
          }));
        } else if (apiStatus === "OVER_QUERY_LIMIT") {
          return {
            ok: false,
            status: "OVER_QUERY_LIMIT",
            code: "places_quota_exceeded",
            error: "Google Places API quota exceeded. Please verify your billing and quota limits in Google Cloud Console.",
          };
        } else if (apiStatus === "REQUEST_DENIED") {
          return {
            ok: false,
            status: "REQUEST_DENIED",
            code: "invalid_api_key",
            error: "Google Places API authorization failed. Please check that GOOGLE_PLACES_API_KEY is valid and has Places API enabled in Google Cloud Console.",
          };
        }
      }
    }

    // 3. Check candidate results
    if (candidates.length === 0) {
      return {
        ok: false,
        status: apiStatus || "ZERO_RESULTS",
        code: "no_match",
        error: `No business location found matching "${query}".`,
      };
    }

    const validCandidates = candidates.filter((c) => c.place_id && isValidPlaceId(c.place_id));
    if (validCandidates.length === 0) {
      return {
        ok: false,
        status: "ZERO_RESULTS",
        code: "no_match",
        error: `No verified Place ID found for "${query}".`,
      };
    }

    // 4. Single candidate match: verify confidence
    if (validCandidates.length === 1) {
      const top = validCandidates[0];
      const matchesConfidence = query.startsWith("cid:") || isNameSimilar(query, top.name);
      if (matchesConfidence) {
        return {
          ok: true,
          place_id: top.place_id,
          name: top.name,
          address: top.address,
          status: "OK",
          candidates: validCandidates,
        };
      }
      return {
        ok: false,
        status: "INSUFFICIENT_CONFIDENCE",
        code: "insufficient_confidence",
        business_name: query,
        error: `Found location "${top.name}" (${top.address || "unknown address"}), but the name does not closely match "${query}". Please confirm your listing or paste the review link directly.`,
        candidates: validCandidates.map((c) => ({
          place_id: c.place_id,
          name: c.name,
          address: c.address,
          review_url: buildGoogleReviewUrl(c.place_id),
        })),
      };
    }

    // 5. Multiple candidates: require user selection to prevent mismatch
    return {
      ok: false,
      status: "MULTIPLE_MATCHES",
      code: "multiple_matches",
      business_name: query,
      error: `Multiple matching locations found for "${query}". Please select the correct listing.`,
      candidates: validCandidates.map((c) => ({
        place_id: c.place_id,
        name: c.name,
        address: c.address,
        review_url: buildGoogleReviewUrl(c.place_id),
      })),
    };
  } catch (err) {
    return {
      ok: false,
      status: err?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
      code: err?.name === "AbortError" ? "upstream_timeout" : "network_error",
      error: err?.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parses a URL string or query parameters to extract a Place ID.
 * Supports:
 *  1. Direct Place ID strings (ChIJ... / GhIJ...)
 *  2. Query parameters: query_place_id, place_id, placeid, destination_place_id, origin_place_id
 *  3. Search queries: q=place_id:..., query=place_id:...
 *  4. Direct Place IDs in pathname: /maps/place/ChIJ...
 *  5. Google feature ID hex pairs in pathname, data=!1s..., ftid=..., or raw 0x...:0x...
 *  6. Safe URL decoding for percent-encoded data parameters (%211s0x...%3A0x...)
 */
export function extractPlaceIdFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const str = rawUrl.trim();

  // 1. Direct Place ID string
  if (isValidPlaceId(str)) {
    return str;
  }

  const unwrapped = unwrapNestedUrl(str);
  const decoded = safeDecodeUrl(unwrapped);

  // 2. Direct Place ID in /maps/place/<placeId> path
  const pathPlaceMatch = decoded.match(/\/maps\/place\/(ChI[A-Za-z0-9_-]{24,}|GhI[A-Za-z0-9_-]{24,})/i);
  if (pathPlaceMatch && isValidPlaceId(pathPlaceMatch[1])) {
    return pathPlaceMatch[1];
  }

  // 3. Feature ID hex pair in path or data (!1s0x<hex1>:0x<hex2>, ftid=0x..., or fid=0x...)
  // Checks decoded string so %211s0x...%3A0x... works seamlessly
  const hexPairMatch = decoded.match(/(?:!1s|ftid=|fid=|\/maps\/place\/)(0x[0-9a-fA-F]{8,16}):(0x[0-9a-fA-F]{8,16})/i);
  if (hexPairMatch) {
    const converted = hexToPlaceId(hexPairMatch[1], hexPairMatch[2]);
    if (converted) return converted;
  }

  // Also check raw 0x...:0x... pattern
  const rawHexMatch = decoded.match(/\b(0x[0-9a-fA-F]{8,16}):(0x[0-9a-fA-F]{8,16})\b/i);
  if (rawHexMatch) {
    const converted = hexToPlaceId(rawHexMatch[1], rawHexMatch[2]);
    if (converted) return converted;
  }

  try {
    const parsed = new URL(decoded.startsWith("http") ? decoded : `https://${decoded}`);

    // Check query params: query_place_id, place_id, placeid, destination_place_id, origin_place_id
    const qPlaceId =
      parsed.searchParams.get("query_place_id") ||
      parsed.searchParams.get("place_id") ||
      parsed.searchParams.get("placeid") ||
      parsed.searchParams.get("destination_place_id") ||
      parsed.searchParams.get("origin_place_id");
    if (qPlaceId && isValidPlaceId(qPlaceId)) {
      return qPlaceId.trim();
    }

    // Check query param: q=place_id:ChIJ... or query=place_id:ChIJ...
    const qParam = parsed.searchParams.get("q") || parsed.searchParams.get("query") || parsed.searchParams.get("daddr") || "";
    const placeIdPrefix = qParam.match(/place_id:([A-Za-z0-9_-]{20,})/i);
    if (placeIdPrefix && isValidPlaceId(placeIdPrefix[1])) {
      return placeIdPrefix[1];
    }

    // Check ftid query param with hex pair
    const ftid = parsed.searchParams.get("ftid") || parsed.searchParams.get("fid");
    if (ftid) {
      const parts = ftid.split(":");
      if (parts.length === 2) {
        const converted = hexToPlaceId(parts[0], parts[1]);
        if (converted) return converted;
      }
    }

    // Check data=!4m... parameter for Place ID (e.g. !1sChIJ... or !1sGhIJ...)
    const fullSearch = parsed.search + parsed.pathname;
    const chMatch = fullSearch.match(/(?:!1s|1s|placeid=|place_id=)(ChI[A-Za-z0-9_-]{24,}|GhI[A-Za-z0-9_-]{24,})/i);
    if (chMatch && isValidPlaceId(chMatch[1])) {
      return chMatch[1];
    }
  } catch {}

  // Fallback regex search on the decoded string for ChIJ... or GhIJ...
  const rawMatch = decoded.match(/\b(ChI[A-Za-z0-9_-]{24,}|GhI[A-Za-z0-9_-]{24,})\b/);
  if (rawMatch && isValidPlaceId(rawMatch[1])) {
    return rawMatch[1];
  }

  return null;
}

/**
 * Safely resolves Google Maps URLs, share links, and official review links
 * with strict SSRF protection, DNS validation, bounded redirects, parsing diagnostics,
 * and optional server-side Google Places API fallback.
 */
export async function resolveGoogleMapsUrl(inputUrl, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const dnsLookupImpl = options.dnsLookupImpl || dns.promises.lookup;
  const timeoutMs = options.timeoutMs || 8000;
  const placesApiKey =
    options.placesApiKey ||
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    "";

  if (!inputUrl || typeof inputUrl !== "string" || !inputUrl.trim()) {
    return {
      ok: false,
      code: "invalid_request",
      error: "Please enter a valid Google Maps URL or Place ID.",
      diagnostics: { reason: "empty_input" },
    };
  }

  let currentUrl = inputUrl.trim();

  // 1. Direct Place ID string entered directly (e.g. ChIJ...)
  if (isValidPlaceId(currentUrl)) {
    return {
      ok: true,
      place_id: currentUrl,
      review_url: buildGoogleReviewUrl(currentUrl),
      verification: "not_verified",
      source: "direct_place_id",
      placeId: currentUrl,
      reviewUrl: buildGoogleReviewUrl(currentUrl),
      resolved_url: null,
      resolvedUrl: null,
      diagnostics: { detectedFormat: "direct_place_id", hops: 0 },
    };
  }

  if (!/^https?:\/\//i.test(currentUrl)) {
    currentUrl = `https://${currentUrl}`;
  }

  // 2. Parse and strictly validate initial URL domain before extracting or resolving
  let parsedInit;
  try {
    parsedInit = new URL(currentUrl);
  } catch {
    return {
      ok: false,
      code: "invalid_request",
      error: "Malformed URL provided.",
      diagnostics: { reason: "url_parse_error" },
    };
  }

  if (parsedInit.protocol !== "http:" && parsedInit.protocol !== "https:") {
    return {
      ok: false,
      code: "unsupported_url",
      error: "Only HTTP and HTTPS URLs are supported.",
      diagnostics: { reason: "unsupported_protocol", protocol: parsedInit.protocol },
    };
  }

  if (!isApprovedGoogleDomain(parsedInit.hostname)) {
    return {
      ok: false,
      code: "unsupported_url",
      error: "Please provide a valid Google Maps, maps.app.goo.gl, or share.google URL.",
      diagnostics: { reason: "unapproved_domain", hostname: parsedInit.hostname },
    };
  }

  // 3. Validate official review URLs directly on approved domains (e.g. search.google.com/local/writereview?placeid=...)
  const officialCheck = validateOfficialReviewUrl(currentUrl);
  if (officialCheck.valid && officialCheck.type === "canonical_review") {
    return {
      ok: true,
      place_id: officialCheck.placeId,
      review_url: officialCheck.url,
      verification: "official_review_url",
      source: "official_review_url",
      placeId: officialCheck.placeId,
      reviewUrl: officialCheck.url,
      resolved_url: currentUrl,
      resolvedUrl: currentUrl,
      diagnostics: { detectedFormat: "canonical_review", hops: 0 },
    };
  }

  // 4. Immediate extraction on approved domains before network calls (e.g. full Maps URL with embedded !1s0x... or query_place_id)
  const directPlaceId = extractPlaceIdFromUrl(currentUrl);
  if (directPlaceId) {
    return {
      ok: true,
      place_id: directPlaceId,
      review_url: buildGoogleReviewUrl(directPlaceId),
      verification: "not_verified",
      source: "url_embedded",
      placeId: directPlaceId,
      reviewUrl: buildGoogleReviewUrl(directPlaceId),
      resolved_url: currentUrl,
      resolvedUrl: currentUrl,
      diagnostics: { detectedFormat: "url_embedded", hops: 0 },
    };
  }

  // 5. Follow redirects safely with DNS/IP SSRF verification and track diagnostics
  let hops = 0;
  const maxHops = 5;
  let targetUrl = currentUrl;
  const redirectChain = [];
  const startTime = Date.now();
  let lastStatus = null;

  try {
    while (hops < maxHops) {
      if (Date.now() - startTime > timeoutMs) {
        return {
          ok: false,
          code: "upstream_timeout",
          error: "The Google Maps short link resolution timed out. Please try again or paste the full Google Maps URL.",
          diagnostics: { hops, redirectChain, timeoutMs },
        };
      }

      let parsedTarget;
      try {
        parsedTarget = new URL(targetUrl);
      } catch {
        return {
          ok: false,
          code: "invalid_request",
          error: "Redirect target is not a valid URL.",
          diagnostics: { hops, redirectChain, invalidTarget: targetUrl },
        };
      }

      // SSRF check 1: Approved Google domain check
      if (!isApprovedGoogleDomain(parsedTarget.hostname)) {
        return {
          ok: false,
          code: "unsafe_redirect",
          error: "Short link redirected to an unsupported or unapproved domain.",
          diagnostics: { hops, redirectChain, blockedHost: parsedTarget.hostname },
        };
      }

      // SSRF check 2: DNS resolution and private IP check
      try {
        const lookupRes = await dnsLookupImpl(parsedTarget.hostname);
        const resolvedIp = typeof lookupRes === "string" ? lookupRes : lookupRes.address;
        if (isPrivateIp(resolvedIp)) {
          return {
            ok: false,
            code: "unsafe_redirect",
            error: "Redirect target resolves to a private or internal network address.",
            diagnostics: { hops, redirectChain, resolvedIp },
          };
        }
      } catch {
        return {
          ok: false,
          code: "unsafe_redirect",
          error: "Could not resolve redirect hostname safely.",
          diagnostics: { hops, redirectChain, failedHost: parsedTarget.hostname },
        };
      }

      // Unwrap nested Google redirect wrapper (google.com/url?q=... or consent.google.com/?continue=...)
      const unwrappedTarget = unwrapNestedUrl(targetUrl);
      if (unwrappedTarget !== targetUrl) {
        targetUrl = unwrappedTarget;
        const found = extractPlaceIdFromUrl(targetUrl);
        if (found) {
          return {
            ok: true,
            place_id: found,
            review_url: buildGoogleReviewUrl(found),
            verification: "not_verified",
            source: "unwrapped_redirect",
            placeId: found,
            reviewUrl: buildGoogleReviewUrl(found),
            resolved_url: targetUrl,
            resolvedUrl: targetUrl,
            diagnostics: { hops, redirectChain, finalUrl: targetUrl },
          };
        }
      }

      const controller = new AbortController();
      const remainingTime = Math.max(1000, timeoutMs - (Date.now() - startTime));
      const timer = setTimeout(() => controller.abort(), remainingTime);

      let resp;
      try {
        resp = await fetchImpl(targetUrl, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
        });
      } catch (getErr) {
        clearTimeout(timer);
        if (controller.signal.aborted) {
          return {
            ok: false,
            code: "upstream_timeout",
            error: "The Google Maps short link resolution timed out. Please try again or paste the full Google Maps URL.",
            diagnostics: { hops, redirectChain, timeoutMs },
          };
        }
        throw getErr;
      } finally {
        clearTimeout(timer);
      }

      lastStatus = resp.status;
      const location = resp.headers?.get ? resp.headers.get("location") : null;
      redirectChain.push({
        hop: hops,
        from: targetUrl,
        status: resp.status,
        location: location || null,
      });

      if (location && [301, 302, 303, 307, 308].includes(resp.status)) {
        hops++;
        targetUrl = new URL(location, targetUrl).toString();

        const found = extractPlaceIdFromUrl(targetUrl);
        if (found) {
          return {
            ok: true,
            place_id: found,
            review_url: buildGoogleReviewUrl(found),
            verification: "not_verified",
            source: "redirect_target",
            placeId: found,
            reviewUrl: buildGoogleReviewUrl(found),
            resolved_url: targetUrl,
            resolvedUrl: targetUrl,
            diagnostics: { hops, redirectChain, finalUrl: targetUrl, status: resp.status },
          };
        }
      } else {
        // 200 OK or end of redirect chain
        break;
      }
    }
  } catch (netErr) {
    if (netErr?.name === "AbortError") {
      return {
        ok: false,
        code: "upstream_timeout",
        error: "The Google Maps short link resolution timed out. Please try again or paste the full Google Maps URL.",
        diagnostics: { hops, redirectChain, timeoutMs },
      };
    }
  }

  // 6. Check final targetUrl for Place ID
  const finalPlaceId = extractPlaceIdFromUrl(targetUrl);
  if (finalPlaceId) {
    return {
      ok: true,
      place_id: finalPlaceId,
      review_url: buildGoogleReviewUrl(finalPlaceId),
      verification: "not_verified",
      source: "final_target",
      placeId: finalPlaceId,
      reviewUrl: buildGoogleReviewUrl(finalPlaceId),
      resolved_url: targetUrl,
      resolvedUrl: targetUrl,
      diagnostics: { hops, redirectChain, finalUrl: targetUrl, status: lastStatus },
    };
  }

  // 7. Check if target or original URL is a validated official review URL (e.g. g.page/r/.../review)
  const targetCheck = validateOfficialReviewUrl(targetUrl);
  const origCheck = validateOfficialReviewUrl(currentUrl);
  const targetOfficial = targetCheck.valid ? targetCheck : origCheck;
  if (targetOfficial && targetOfficial.valid && (targetOfficial.type === "g_page_review" || targetOfficial.type === "canonical_review")) {
    const finalReviewUrl = targetOfficial.url || targetUrl;
    return {
      ok: true,
      place_id: targetOfficial.placeId || null,
      review_url: finalReviewUrl,
      verification: "official_review_url",
      source: "official_review_url",
      placeId: targetOfficial.placeId || finalReviewUrl,
      reviewUrl: finalReviewUrl,
      resolved_url: targetUrl,
      resolvedUrl: targetUrl,
      diagnostics: { hops, redirectChain, officialType: targetOfficial.type },
    };
  }

  // 8. Extract metadata (businessName, cid, coordinates, kgmid, kgs) from resolved URL
  const meta = extractMapsMetadata(targetUrl) || extractMapsMetadata(currentUrl);

  // 9. Optional Google Places API fallback (if configured)
  if (placesApiKey) {
    const lookupQuery = meta?.businessName || (meta?.cid ? `cid:${meta.cid}` : null);
    if (lookupQuery) {
      const apiRes = await lookupGooglePlacesApi({
        query: lookupQuery,
        lat: meta?.coordinates?.lat,
        lng: meta?.coordinates?.lng,
        apiKey: placesApiKey,
        fetchImpl,
      });

      if (apiRes) {
        if (apiRes.ok && apiRes.place_id) {
          return {
            ok: true,
            place_id: apiRes.place_id,
            review_url: buildGoogleReviewUrl(apiRes.place_id),
            business_name: apiRes.name || meta?.businessName,
            address: apiRes.address || null,
            verification: "places_api_verified",
            source: "google_places_api",
            placeId: apiRes.place_id,
            reviewUrl: buildGoogleReviewUrl(apiRes.place_id),
            resolved_url: targetUrl,
            resolvedUrl: targetUrl,
            diagnostics: {
              hops,
              redirectChain,
              finalUrl: targetUrl,
              placesApiStatus: apiRes.status,
              businessName: meta?.businessName,
              placesApiConfigured: true,
            },
          };
        }

        if (apiRes.code) {
          return {
            ok: false,
            code: apiRes.code,
            error: apiRes.error,
            business_name: meta?.businessName || lookupQuery,
            candidates: apiRes.candidates || [],
            resolved_url: targetUrl,
            resolvedUrl: targetUrl,
            diagnostics: {
              hops,
              redirectChain,
              finalUrl: targetUrl,
              status: lastStatus,
              businessName: meta?.businessName || null,
              kgmid: meta?.kgmid || null,
              kgs: meta?.kgs || null,
              cid: meta?.cid || null,
              placesApiConfigured: true,
              placesApiStatus: apiRes.status,
            },
          };
        }
      }
    }
  }

  // 10. Could not identify a specific Place ID — return actionable diagnostics
  const reasonDiagnostic = meta?.businessName
    ? `URL resolved to Google Search for business '${meta.businessName}'${meta.kgmid ? ` (kgmid: ${meta.kgmid})` : ""}, but Google did not embed a Place ID in the URL. Configure server-side GOOGLE_PLACES_API_KEY for automated resolution, or paste the official Google review link directly.`
    : meta?.cid
    ? `URL contains CID '${meta.cid}', which is not a Place ID. Use an official share link, paste your review link, or configure GOOGLE_PLACES_API_KEY.`
    : "Could not identify a specific business location in this link.";

  return {
    ok: false,
    code: "place_id_not_found",
    error: "Could not automatically resolve the Google Place ID from this link. You can paste your official Google review link or Place ID directly.",
    resolved_url: targetUrl,
    resolvedUrl: targetUrl,
    business_name: meta?.businessName || null,
    diagnostics: {
      hops,
      redirectChain,
      finalUrl: targetUrl,
      status: lastStatus,
      businessName: meta?.businessName || null,
      kgmid: meta?.kgmid || null,
      kgs: meta?.kgs || null,
      cid: meta?.cid || null,
      placesApiConfigured: Boolean(placesApiKey),
      reason: reasonDiagnostic,
    },
  };
}
