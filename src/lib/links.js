// src/lib/links.js  (v9 production repair)
// Links and scans are served and mutated through the secure backend API (/api/links),
// with plan limit enforcement and persistent storage in PostgreSQL / durable database.
// Real-time Firestore snapshot listeners are attached as progressive enhancements if Firestore is active.

import {
  collection, doc, getDocs, onSnapshot,
  query, where, orderBy, limit, writeBatch, Timestamp,
} from "firebase/firestore";
import { db, getFirestoreStatus, setFirestoreUnavailable, setFirestoreAvailable } from "./firebase.js";
import { api } from "./api.js";
import { isValidHttpUrl } from "./qrPayloads.js";
import { cleanBio, cleanDesign, cleanDestinations, cleanMax } from "../../shared/linkClean.js";

export { cleanBio };

const getLinksCol = () => (db ? collection(db, "links") : null);
const toTs = (date) => (date ? Timestamp.fromDate(date) : null);

/** Public base for QR links — set VITE_PUBLIC_BASE_URL to use your own short domain. */
export const publicBase = () => {
  const runtimeConfig = (typeof window !== "undefined" && window.__APP_CONFIG__) || {};
  const nodeEnv = (typeof process !== "undefined" && process.env) || {};
  return (
    runtimeConfig.publicBaseUrl ||
    ((typeof import.meta !== "undefined" && import.meta.env?.VITE_PUBLIC_BASE_URL) || "") ||
    nodeEnv.PUBLIC_BASE_URL ||
    nodeEnv.VITE_PUBLIC_BASE_URL ||
    (nodeEnv.RAILWAY_PUBLIC_DOMAIN ? `https://${nodeEnv.RAILWAY_PUBLIC_DOMAIN}` : "") ||
    (typeof window !== "undefined" && window.location ? window.location.origin : "") ||
    "https://qr-pro-kit-saas-production.up.railway.app"
  ).replace(/\/+$/, "");
};

/**
 * Bitly-style TypQR short URL (/r/:slug).
 * Accepts either a link object (with slug/id/shortUrl) or a slug/id string.
 */
export const shortUrlFor = (linkOrSlug) => {
  if (!linkOrSlug) return "";
  if (typeof linkOrSlug === "string") {
    if (/^https?:\/\//i.test(linkOrSlug)) return linkOrSlug;
    return `${publicBase()}/r/${linkOrSlug}`;
  }
  if (linkOrSlug.shortUrl && /^https?:\/\//i.test(linkOrSlug.shortUrl)) {
    return linkOrSlug.shortUrl;
  }
  const slug = linkOrSlug.slug || linkOrSlug.id || "";
  return slug ? `${publicBase()}/r/${slug}` : "";
};

/** Dynamic URL for links — uses canonical TypQR short link (/r/:slug). */
export const dynamicUrlFor = (linkOrId) => shortUrlFor(linkOrId);

/**
 * Resolves a Google Maps URL, short link, or raw Place ID into an official direct Google review URL.
 * Direct review URL format: https://search.google.com/local/writereview?placeid=PLACE_ID
 * Standalone: Does not require authentication or TypQR short links.
 */
export async function resolveGoogleReviewLink(inputUrl) {
  return await api("/api/links?action=resolve-google-review", {
    method: "POST",
    body: { url: inputUrl, maps_url: inputUrl },
    signedIn: false,
  });
}

function toServerLink({
  destination = "", label, type = "url", kind = "redirect", payload = "", bio = null,
  password = null, design = null, destinations = null, expiresAt = null, maxScans = null,
}) {
  return {
    kind, destination, label, type, payload, bio, password, design, destinations,
    expiresAt: expiresAt ? (expiresAt instanceof Date ? expiresAt.getTime() : expiresAt) : null,
    maxScans: maxScans || null,
  };
}

// Create one link, returns the new short id. Throws ApiError (with .upgrade = true) when a plan limit is hit.
export async function createLink(args) {
  const { destination = "", kind = "redirect", payload = "" } = args;
  if (kind === "static" && !(payload || "").trim()) throw new Error("Nothing to save.");
  if (kind === "redirect" && !isValidHttpUrl((destination || "").trim())) throw new Error("Destination must be a valid http or https URL.");
  const { id } = await api("/api/links?action=create", { method: "POST", body: { link: toServerLink(args) } });
  triggerMyLinksRefresh();
  return id;
}

// Bulk create (Pro+): rows = [{ destination, label, design }, ...] -> ids in the same order. All-or-nothing.
export async function createLinks(rows) {
  const { ids } = await api("/api/links?action=create-many", { method: "POST", body: { items: rows.map((r) => toServerLink({ ...r, kind: "redirect" })) } });
  triggerMyLinksRefresh();
  return ids;
}

// Bulk quantity generator (Pro+): generates quantity (10 - 1000) batch of QR codes within [minQuantity, maxQuantity] range
export async function createBulkQuantity({ quantity, minQuantity, maxQuantity, defaultDestination, design }) {
  const data = await api("/api/links?action=bulk-quantity", {
    method: "POST",
    body: {
      quantity: quantity !== undefined ? quantity : minQuantity,
      minQuantity: minQuantity || 10,
      maxQuantity: maxQuantity || 1000,
      defaultDestination,
      design,
    },
  });
  triggerMyLinksRefresh();
  return data.ids;
}

// Fetch all links owned by the signed-in user from the backend API
export async function fetchMyLinks() {
  const res = await api("/api/links?action=list");
  return res.links || [];
}

/** Patch any of: label, destination, destinations, bio, password ({salt,hash,iter}|null), active, expiresAt, maxScans, design */
export async function updateLink(id, patch = {}) {
  const out = {};
  if ("label" in patch) out.label = (patch.label || "").trim().slice(0, 120) || "Untitled";
  if ("destination" in patch) {
    const dest = (patch.destination || "").trim();
    if (!isValidHttpUrl(dest)) throw new Error("Destination must be a valid http or https URL.");
    out.destination = dest;
  }
  if ("destinations" in patch) out.destinations = cleanDestinations(patch.destinations);
  if ("bio" in patch) out.bio = cleanBio(patch.bio);
  if ("payload" in patch) out.payload = String(patch.payload || "").slice(0, 4000);
  if ("password" in patch) {
    const p = patch.password;
    out.password = p && p.hash ? { salt: p.salt, hash: p.hash, iter: p.iter } : null;
  }
  if ("active" in patch) out.active = !!patch.active;
  if ("expiresAt" in patch) {
    out.expiresAt = patch.expiresAt instanceof Date ? patch.expiresAt.getTime() : patch.expiresAt;
  }
  if ("maxScans" in patch) out.maxScans = cleanMax(patch.maxScans);
  if ("design" in patch) out.design = cleanDesign(patch.design);
  if ("slug" in patch && patch.slug) out.slug = (patch.slug || "").trim();
  if (!Object.keys(out).length) return;

  const res = await api("/api/links?action=update", {
    method: "POST",
    body: { id, patch: out },
  });
  triggerMyLinksRefresh();
  return res;
}

export const updateDestination = (id, destination) => updateLink(id, { destination });
export const renameLink = (id, label) => updateLink(id, { label });

export async function deleteLink(id) {
  const res = await api("/api/links?action=delete", {
    method: "POST",
    body: { id },
  });
  triggerMyLinksRefresh();
  return res;
}

const activeRefreshListeners = new Set();

export function triggerMyLinksRefresh() {
  for (const fn of activeRefreshListeners) {
    try {
      fn();
    } catch {}
  }
}

export function subscribeToMyLinks(ownerId, callback, onError) {
  let active = true;
  let latestApiRows = null;

  const loadFromApi = async () => {
    try {
      const links = await fetchMyLinks();
      if (!active) return;
      latestApiRows = Array.isArray(links) ? links : [];
      callback(latestApiRows);
    } catch (err) {
      if (active && onError) onError(err);
    }
  };

  activeRefreshListeners.add(loadFromApi);

  // Immediate fetch via API
  loadFromApi();

  // Polling fallback to keep dashboard fresh across devices / scans
  const pollInterval = setInterval(loadFromApi, 8000);

  // Firestore real-time listener if available
  let unsubFirestore = () => {};
  const col = getLinksCol();
  if (db && col && getFirestoreStatus().available !== false) {
    try {
      const q = query(col, where("ownerId", "==", ownerId));
      unsubFirestore = onSnapshot(
        q,
        (snap) => {
          if (!active) return;
          setFirestoreAvailable();
          const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

          // Only allow Firestore snapshot to update state if it has records,
          // or if the backend API has already responded with an empty list.
          // This prevents an empty Firestore query from overwriting links stored in the persistent backend DB.
          if (rows.length > 0) {
            callback(rows);
          } else if (latestApiRows !== null && latestApiRows.length === 0) {
            callback([]);
          }
        },
        () => {
          // Silent fallback to polling if Firestore is not provisioned
        }
      );
    } catch {
      // Ignored: API polling handles updates
    }
  }

  return () => {
    active = false;
    activeRefreshListeners.delete(loadFromApi);
    clearInterval(pollInterval);
    unsubFirestore();
  };
}

export function subscribeToScans(id, callback, onError) {
  let active = true;

  const loadScans = async () => {
    try {
      const res = await api(`/api/links?action=scans&id=${encodeURIComponent(id)}`);
      if (active) callback(res.scans || []);
    } catch (err) {
      if (active && onError) onError(err);
    }
  };

  loadScans();
  const timer = setInterval(loadScans, 6000);

  return () => {
    active = false;
    clearInterval(timer);
  };
}

export function linkStatus(link) {
  if (link.kind === "static") return { id: "static", label: "Static" };
  if (link.active === false) return { id: "paused", label: "Paused" };
  const exp = link.expiresAt?.toMillis ? link.expiresAt.toMillis() : link.expiresAt ? new Date(link.expiresAt).getTime() : 0;
  if (exp && exp < Date.now()) return { id: "expired", label: "Expired" };
  if (link.maxScans && (link.scans || 0) >= link.maxScans) return { id: "limit", label: "Limit reached" };
  return { id: "active", label: "Active" };
}
