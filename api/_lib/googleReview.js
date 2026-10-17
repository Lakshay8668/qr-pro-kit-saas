// api/_lib/googleReview.js
// Safe extraction and resolution for Google Maps URLs and Google Review link generation.
// Direct Google review format: https://search.google.com/local/writereview?placeid=PLACE_ID

const PLACE_ID_REGEX = /^[A-Za-z0-9_-]{20,80}$/;

/**
 * Checks if a string looks like a valid Google Place ID.
 */
export function isValidPlaceId(str) {
  if (!str || typeof str !== "string") return false;
  const s = str.trim();
  // Typical Google Place IDs start with ChI or GhI and are 27-40+ chars of base64url characters
  if (/^ChI[A-Za-z0-9_-]{24,}$/.test(s) || /^GhI[A-Za-z0-9_-]{24,}$/.test(s)) return true;
  return PLACE_ID_REGEX.test(s) && !s.includes("/") && !s.includes(".");
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
 * Parses a URL string or query parameters to extract a Place ID if directly present.
 */
export function extractPlaceIdFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const str = rawUrl.trim();

  // 1. Direct Place ID string (e.g. ChIJN1t_tDeuEmsRUsoyG83frY4)
  if (isValidPlaceId(str)) {
    return str;
  }

  try {
    const parsed = new URL(str.startsWith("http") ? str : `https://${str}`);

    // Check query params: ?placeid=... or ?place_id=...
    const qPlaceId = parsed.searchParams.get("placeid") || parsed.searchParams.get("place_id");
    if (qPlaceId && isValidPlaceId(qPlaceId)) {
      return qPlaceId.trim();
    }

    // Check query param query or q=place_id:ChIJ...
    const qParam = parsed.searchParams.get("q") || parsed.searchParams.get("query") || "";
    const placeIdPrefix = qParam.match(/place_id:([A-Za-z0-9_-]{20,})/);
    if (placeIdPrefix && isValidPlaceId(placeIdPrefix[1])) {
      return placeIdPrefix[1];
    }

    // Check data=!4m... parameter for Place ID (e.g. !1sChIJ...)
    const fullSearch = parsed.search + parsed.pathname;
    const chMatch = fullSearch.match(/(?:!1s|1s|placeid=|place_id=)(ChI[A-Za-z0-9_-]{24,})/);
    if (chMatch && isValidPlaceId(chMatch[1])) {
      return chMatch[1];
    }
  } catch {}

  // Fallback regex search on the raw string for ChIJ... or GhIJ...
  const rawMatch = str.match(/\b(ChI[A-Za-z0-9_-]{24,})\b/);
  if (rawMatch && isValidPlaceId(rawMatch[1])) {
    return rawMatch[1];
  }

  return null;
}

/**
 * Safely resolves short URLs (like maps.app.goo.gl, goo.gl, share.google)
 * by following redirects up to 5 hops with timeout and SSRF protection.
 */
export async function resolveGoogleMapsUrl(inputUrl, fetchImpl = fetch) {
  if (!inputUrl || typeof inputUrl !== "string") {
    return { ok: false, error: "Please enter a valid Google Maps URL or Place ID." };
  }

  let currentUrl = inputUrl.trim();
  if (!/^https?:\/\//i.test(currentUrl)) {
    // If it looks like a direct Place ID
    if (isValidPlaceId(currentUrl)) {
      return {
        ok: true,
        placeId: currentUrl,
        reviewUrl: buildGoogleReviewUrl(currentUrl),
        resolvedUrl: null,
      };
    }
    currentUrl = `https://${currentUrl}`;
  }

  // Check if Place ID is already in the URL
  const directPlaceId = extractPlaceIdFromUrl(currentUrl);
  if (directPlaceId) {
    return {
      ok: true,
      placeId: directPlaceId,
      reviewUrl: buildGoogleReviewUrl(directPlaceId),
      resolvedUrl: currentUrl,
    };
  }

  // SSRF guard: only permit HTTP/HTTPS and Google domains or well-known short domains
  let parsedInit;
  try {
    parsedInit = new URL(currentUrl);
  } catch {
    return { ok: false, error: "Malformed URL provided." };
  }

  const hostname = parsedInit.hostname.toLowerCase();
  const isGoogleDomain =
    hostname === "maps.app.goo.gl" ||
    hostname === "goo.gl" ||
    hostname === "maps.google.com" ||
    hostname.endsWith(".google.com") ||
    hostname.endsWith(".google.co.in") ||
    hostname.endsWith(".google.co.uk") ||
    hostname.endsWith(".google.com.au") ||
    hostname === "g.page" ||
    hostname.endsWith(".g.page") ||
    hostname === "share.google" ||
    hostname.endsWith(".share.google") ||
    hostname === "search.google.com";

  if (!isGoogleDomain) {
    return {
      ok: false,
      error: "Please provide an official Google Maps, share.google, or Google review URL.",
    };
  }

  // Follow redirects safely
  let hops = 0;
  const maxHops = 5;
  let targetUrl = currentUrl;

  try {
    while (hops < maxHops) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);

      const resp = await fetchImpl(targetUrl, {
        method: "HEAD",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      clearTimeout(timer);

      const location = resp.headers.get("location");
      if (location && [301, 302, 303, 307, 308].includes(resp.status)) {
        hops++;
        targetUrl = new URL(location, targetUrl).toString();

        const found = extractPlaceIdFromUrl(targetUrl);
        if (found) {
          return {
            ok: true,
            placeId: found,
            reviewUrl: buildGoogleReviewUrl(found),
            resolvedUrl: targetUrl,
          };
        }
      } else {
        // No more redirects or 200 OK reached
        break;
      }
    }
  } catch (netErr) {
    // If HEAD failed or timed out, attempt GET once if hops === 0
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const getResp = await fetchImpl(targetUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      clearTimeout(timer);
      const finalUrl = getResp.url || targetUrl;
      const found = extractPlaceIdFromUrl(finalUrl);
      if (found) {
        return {
          ok: true,
          placeId: found,
          reviewUrl: buildGoogleReviewUrl(found),
          resolvedUrl: finalUrl,
        };
      }
      // Inspect initial chunk of HTML body for Place ID (Google Maps embeds Place ID in JS payload)
      try {
        const text = await getResp.text();
        const snippet = text.slice(0, 100000);
        const bodyMatch = snippet.match(/["'](ChI[A-Za-z0-9_-]{24,})["']/);
        if (bodyMatch && isValidPlaceId(bodyMatch[1])) {
          return {
            ok: true,
            placeId: bodyMatch[1],
            reviewUrl: buildGoogleReviewUrl(bodyMatch[1]),
            resolvedUrl: finalUrl,
          };
        }
      } catch {}
    } catch {}
  }

  // Final check on targetUrl
  const finalPlaceId = extractPlaceIdFromUrl(targetUrl);
  if (finalPlaceId) {
    return {
      ok: true,
      placeId: finalPlaceId,
      reviewUrl: buildGoogleReviewUrl(finalPlaceId),
      resolvedUrl: targetUrl,
    };
  }

  // If Place ID could not be extracted automatically, provide actionable feedback
  return {
    ok: false,
    error: "Could not automatically resolve the Google Place ID from this link. You can paste your official Google review link or Place ID directly.",
    resolvedUrl: targetUrl,
  };
}
