// src/lib/links.js  (v9)
// v9: links are CREATED by the server (api/links.js) so plan limits can't be bypassed from the browser.
// The browser still edits / deletes its own links straight in Firestore (rules gate the plan-only features).
// Scans are served by the Vercel function (api/q/[id].js); the browser never writes scan data.
//
// links/{id}  { kind: "redirect"|"bio"|"static", type, destination, destinations{ios,android},
//               bio{title,description,accent,avatar,links[]}, password{salt,hash,iter},
//               label, scans, active, expiresAt, maxScans, design, ownerId, createdAt, lastScannedAt }
// links/{id}/scans  { ts, ev: "scan"|"click", device, os, browser, lang, country, region, city, vid, target? }

import {
  collection, doc, getDocs, updateDoc, deleteDoc, onSnapshot,
  query, where, orderBy, limit, writeBatch, Timestamp,
} from "firebase/firestore";
import { db, getFirestoreStatus, setFirestoreUnavailable, setFirestoreAvailable } from "./firebase";
import { api } from "./api";
import { isValidHttpUrl } from "./qrPayloads";
import { cleanBio, cleanDesign, cleanDestinations, cleanMax } from "../../shared/linkClean";

export { cleanBio };

const linksCol = collection(db, "links");
const toTs = (date) => (date ? Timestamp.fromDate(date) : null);

/** Public base for QR links — set VITE_PUBLIC_BASE_URL to use your own short domain. */
export const publicBase = () => (import.meta.env.VITE_PUBLIC_BASE_URL || window.location.origin).replace(/\/+$/, "");
export const dynamicUrlFor = (id) => `${publicBase()}/q/${id}`;

function toServerLink({
  destination = "", label, type = "url", kind = "redirect", payload = "", bio = null,
  password = null, design = null, destinations = null, expiresAt = null, maxScans = null,
}) {
  return {
    kind, destination, label, type, payload, bio, password, design, destinations,
    expiresAt: expiresAt ? expiresAt.getTime() : null,
    maxScans: maxScans || null,
  };
}

// Create one link, returns the new short id. Throws ApiError (with .upgrade = true) when a plan limit is hit.
export async function createLink(args) {
  const { destination = "", kind = "redirect", payload = "" } = args;
  if (kind === "static" && !(payload || "").trim()) throw new Error("Nothing to save.");
  if (kind === "redirect" && !isValidHttpUrl((destination || "").trim())) throw new Error("Destination must be a valid http or https URL.");
  const { id } = await api("/api/links?action=create", { method: "POST", body: { link: toServerLink(args) } });
  return id;
}

// Bulk create (Pro+): rows = [{ destination, label, design }, ...] -> ids in the same order. All-or-nothing.
export async function createLinks(rows) {
  const { ids } = await api("/api/links?action=create-many", { method: "POST", body: { items: rows.map((r) => toServerLink({ ...r, kind: "redirect" })) } });
  return ids;
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
  if ("expiresAt" in patch) out.expiresAt = toTs(patch.expiresAt);
  if ("maxScans" in patch) out.maxScans = cleanMax(patch.maxScans);
  if ("design" in patch) out.design = cleanDesign(patch.design);
  if (!Object.keys(out).length) return;
  try {
    await updateDoc(doc(db, "links", id), out);
  } catch (e) {
    if (e?.code === "permission-denied" && ("password" in out || "destinations" in out)) {
      throw new Error("Password protection and per-device redirects are part of the Pro plan. Upgrade to use them.");
    }
    throw e;
  }
}

export const updateDestination = (id, destination) => updateLink(id, { destination });
export const renameLink = (id, label) => updateLink(id, { label });

export async function deleteLink(id) {
  const scansCol = collection(db, "links", id, "scans");
  for (let i = 0; i < 25; i++) {
    const snap = await getDocs(query(scansCol, limit(400)));
    if (snap.empty) break;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  await deleteDoc(doc(db, "links", id));
}

export function subscribeToMyLinks(ownerId, callback, onError) {
  const status = getFirestoreStatus();
  if (status.available === false) {
    if (onError) onError(new Error(status.error || "Cloud Firestore is not available."));
    callback([]);
    return () => {};
  }

  let unsub = () => {};
  try {
    const q = query(linksCol, where("ownerId", "==", ownerId));
    unsub = onSnapshot(
      q,
      (snap) => {
        setFirestoreAvailable();
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        callback(rows);
      },
      (err) => {
        const msg = err?.message || "";
        const code = err?.code || "";
        if (
          code === "not-found" ||
          code === "failed-precondition" ||
          code === "unavailable" ||
          msg.includes("not found") ||
          msg.includes("does not exist") ||
          msg.includes("(default)")
        ) {
          setFirestoreUnavailable(err);
        }
        if (onError) onError(err);
      }
    );
  } catch (err) {
    setFirestoreUnavailable(err);
    if (onError) onError(err);
    callback([]);
    return () => {};
  }

  return unsub;
}

export function subscribeToScans(id, callback, onError) {
  const status = getFirestoreStatus();
  if (status.available === false) {
    if (onError) onError(new Error(status.error || "Cloud Firestore is not available."));
    callback([]);
    return () => {};
  }

  let unsub = () => {};
  try {
    const q = query(collection(db, "links", id, "scans"), orderBy("ts", "desc"), limit(2000));
    unsub = onSnapshot(
      q,
      (snap) => {
        setFirestoreAvailable();
        callback(
          snap.docs.map((d) => {
            const v = d.data();
            return { id: d.id, ...v, t: v.ts?.toMillis?.() ?? Date.now() };
          })
        );
      },
      (err) => {
        const msg = err?.message || "";
        const code = err?.code || "";
        if (
          code === "not-found" ||
          code === "failed-precondition" ||
          code === "unavailable" ||
          msg.includes("not found") ||
          msg.includes("does not exist") ||
          msg.includes("(default)")
        ) {
          setFirestoreUnavailable(err);
        }
        if (onError) onError(err);
      }
    );
  } catch (err) {
    setFirestoreUnavailable(err);
    if (onError) onError(err);
    callback([]);
    return () => {};
  }

  return unsub;
}

export function linkStatus(link) {
  if (link.kind === "static") return { id: "static", label: "Static" };
  if (link.active === false) return { id: "paused", label: "Paused" };
  const exp = link.expiresAt?.toMillis?.();
  if (exp && exp < Date.now()) return { id: "expired", label: "Expired" };
  if (link.maxScans && (link.scans || 0) >= link.maxScans) return { id: "limit", label: "Limit reached" };
  return { id: "active", label: "Active" };
}
