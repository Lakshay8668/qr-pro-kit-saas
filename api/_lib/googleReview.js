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
function unwrapNestedUrl(urlStr) {
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
 * Parses a URL string or query parameters to extract a Place ID.
 * Supports:
 *  1. Direct Place ID strings (ChIJ...)
 *  2. placeid= / place_id= query parameters
 *  3. Google feature ID hex pairs: !1s0x...:0x..., ftid=0x...:0x..., fid=0x...:0x...
 *  4. Nested Google redirect URLs (?q=... or ?continue=...)
 */
export function extractPlaceIdFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const str = rawUrl.trim();

  // 1. Direct Place ID string
  if (isValidPlaceId(str)) {
    return str;
  }

  const unwrapped = unwrapNestedUrl(str);

  // 2. Look for feature ID hex pair !1s0x<hex1>:0x<hex2> or ftid=0x...:0x...
  // Matches: !1s0x47b18f1cae867bab:0xb6f8b3a3753ba1a2 or ftid=0x...:0x...
  const hexPairMatch = unwrapped.match(/(?:!1s|ftid=|fid=)(0x[0-9a-fA-F]{10,16}):(0x[0-9a-fA-F]{10,16})/);
  if (hexPairMatch) {
    const converted = hexToPlaceId(hexPairMatch[1], hexPairMatch[2]);
    if (converted) return converted;
  }

  // Also check raw 0x...:0x... pattern
  const rawHexMatch = unwrapped.match(/\b(0x[0-9a-fA-F]{12,16}):(0x[0-9a-fA-F]{12,16})\b/);
  if (rawHexMatch) {
    const converted = hexToPlaceId(rawHexMatch[1], rawHexMatch[2]);
    if (converted) return converted;
  }

  try {
    const parsed = new URL(unwrapped.startsWith("http") ? unwrapped : `https://${unwrapped}`);

    // Check query params: ?placeid=... or ?place_id=...
    const qPlaceId = parsed.searchParams.get("placeid") || parsed.searchParams.get("place_id");
    if (qPlaceId && isValidPlaceId(qPlaceId)) {
      return qPlaceId.trim();
    }

    // Check query param: q=place_id:ChIJ...
    const qParam = parsed.searchParams.get("q") || parsed.searchParams.get("query") || "";
    const placeIdPrefix = qParam.match(/place_id:([A-Za-z0-9_-]{20,})/);
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

    // Check data=!4m... parameter for Place ID (e.g. !1sChIJ...)
    const fullSearch = parsed.search + parsed.pathname;
    const chMatch = fullSearch.match(/(?:!1s|1s|placeid=|place_id=)(ChI[A-Za-z0-9_-]{24,})/);
    if (chMatch && isValidPlaceId(chMatch[1])) {
      return chMatch[1];
    }
  } catch {}

  // Fallback regex search on the raw string for ChIJ... or GhIJ...
  const rawMatch = unwrapped.match(/\b(ChI[A-Za-z0-9_-]{24,})\b/);
  if (rawMatch && isValidPlaceId(rawMatch[1])) {
    return rawMatch[1];
  }

  return null;
}

/**
 * Safely resolves short URLs (like maps.app.goo.gl, goo.gl, share.google)
 * with strict SSRF protection, DNS validation, bounded redirects, and timeout.
 */
export async function resolveGoogleMapsUrl(inputUrl, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const dnsLookupImpl = options.dnsLookupImpl || dns.promises.lookup;
  const timeoutMs = options.timeoutMs || 8000;

  if (!inputUrl || typeof inputUrl !== "string" || !inputUrl.trim()) {
    return {
      ok: false,
      code: "invalid_request",
      error: "Please enter a valid Google Maps URL or Place ID.",
    };
  }

  let currentUrl = inputUrl.trim();

  // If raw Place ID was entered directly
  if (isValidPlaceId(currentUrl)) {
    return {
      ok: true,
      place_id: currentUrl,
      review_url: buildGoogleReviewUrl(currentUrl),
      verification: "not_verified",
      placeId: currentUrl,
      reviewUrl: buildGoogleReviewUrl(currentUrl),
      resolved_url: null,
      resolvedUrl: null,
    };
  }

  if (!/^https?:\/\//i.test(currentUrl)) {
    currentUrl = `https://${currentUrl}`;
  }

  // Check if Place ID or feature ID can be extracted immediately without network calls
  const directPlaceId = extractPlaceIdFromUrl(currentUrl);
  if (directPlaceId) {
    return {
      ok: true,
      place_id: directPlaceId,
      review_url: buildGoogleReviewUrl(directPlaceId),
      verification: "not_verified",
      placeId: directPlaceId,
      reviewUrl: buildGoogleReviewUrl(directPlaceId),
      resolved_url: currentUrl,
      resolvedUrl: currentUrl,
    };
  }

  // Parse and validate initial URL domain
  let parsedInit;
  try {
    parsedInit = new URL(currentUrl);
  } catch {
    return {
      ok: false,
      code: "invalid_request",
      error: "Malformed URL provided.",
    };
  }

  if (parsedInit.protocol !== "http:" && parsedInit.protocol !== "https:") {
    return {
      ok: false,
      code: "unsupported_url",
      error: "Only HTTP and HTTPS URLs are supported.",
    };
  }

  if (!isApprovedGoogleDomain(parsedInit.hostname)) {
    return {
      ok: false,
      code: "unsupported_url",
      error: "Please provide a valid Google Maps, maps.app.goo.gl, or share.google URL.",
    };
  }

  // Follow redirects safely with DNS/IP SSRF verification
  let hops = 0;
  const maxHops = 5;
  let targetUrl = currentUrl;
  const startTime = Date.now();

  try {
    while (hops < maxHops) {
      if (Date.now() - startTime > timeoutMs) {
        return {
          ok: false,
          code: "upstream_timeout",
          error: "The Google Maps short link resolution timed out. Please try again or paste the full Google Maps URL.",
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
        };
      }

      // 1. SSRF check: Approved domain check
      if (!isApprovedGoogleDomain(parsedTarget.hostname)) {
        return {
          ok: false,
          code: "unsafe_redirect",
          error: "Short link redirected to an unsupported or unapproved domain.",
        };
      }

      // 2. SSRF check: DNS resolution and private IP check
      try {
        const lookupRes = await dnsLookupImpl(parsedTarget.hostname);
        const resolvedIp = typeof lookupRes === "string" ? lookupRes : lookupRes.address;
        if (isPrivateIp(resolvedIp)) {
          return {
            ok: false,
            code: "unsafe_redirect",
            error: "Redirect target resolves to a private or internal network address.",
          };
        }
      } catch (dnsErr) {
        // If DNS lookup throws an error, reject request
        return {
          ok: false,
          code: "unsafe_redirect",
          error: "Could not resolve redirect hostname safely.",
        };
      }

      // Unwrap any Google redirect wrapper (google.com/url?q=... or consent.google.com/?continue=...)
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
            placeId: found,
            reviewUrl: buildGoogleReviewUrl(found),
            resolved_url: targetUrl,
            resolvedUrl: targetUrl,
          };
        }
      }

      const controller = new AbortController();
      const remainingTime = Math.max(1000, timeoutMs - (Date.now() - startTime));
      const timer = setTimeout(() => controller.abort(), remainingTime);

      let resp;
      try {
        resp = await fetchImpl(targetUrl, {
          method: "HEAD",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        });
      } catch (headErr) {
        // If HEAD is rejected with 405 or fails, attempt single GET with redirect: manual
        try {
          resp = await fetchImpl(targetUrl, {
            method: "GET",
            redirect: "manual",
            signal: controller.signal,
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
          });
        } catch (getErr) {
          clearTimeout(timer);
          if (controller.signal.aborted) {
            return {
              ok: false,
              code: "upstream_timeout",
              error: "The Google Maps short link resolution timed out. Please try again or paste the full Google Maps URL.",
            };
          }
          throw getErr;
        }
      } finally {
        clearTimeout(timer);
      }

      const location = resp.headers.get("location");
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
            placeId: found,
            reviewUrl: buildGoogleReviewUrl(found),
            resolved_url: targetUrl,
            resolvedUrl: targetUrl,
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
      };
    }
  }

  // Final check on targetUrl
  const finalPlaceId = extractPlaceIdFromUrl(targetUrl);
  if (finalPlaceId) {
    return {
      ok: true,
      place_id: finalPlaceId,
      review_url: buildGoogleReviewUrl(finalPlaceId),
      verification: "not_verified",
      placeId: finalPlaceId,
      reviewUrl: buildGoogleReviewUrl(finalPlaceId),
      resolved_url: targetUrl,
      resolvedUrl: targetUrl,
    };
  }

  // If Place ID could not be extracted automatically, return actionable error
  return {
    ok: false,
    code: "place_id_not_found",
    error: "Could not automatically resolve the Google Place ID from this link. You can paste your official Google review link or Place ID directly.",
    resolved_url: targetUrl,
    resolvedUrl: targetUrl,
  };
}
