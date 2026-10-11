// shared/linkClean.js — validation/sanitising for link documents.
// Used by the browser (updateLink) and by the server (api/_lib/links.js, which is now the
// ONLY place links are created, because that is where plan limits are enforced).

export const MAX_LOGO_CHARS = 150000;
export const isHttpUrl = (u) => {
  if (!u || typeof u !== "string") return false;
  try {
    const p = new URL(u.trim()).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
};

export function cleanDesign(design) {
  if (!design || typeof design !== "object") return null;
  const keys = ["fg", "fg2", "bg", "eyeColor", "shape", "eye", "logoScale", "frameStyle", "frameText"];
  const out = {};
  keys.forEach((k) => {
    if (design[k] !== undefined && design[k] !== null) out[k] = design[k];
  });
  out.logo = typeof design.logo === "string" && design.logo.length <= MAX_LOGO_CHARS ? design.logo : null;
  return out;
}

export function cleanDestinations(d) {
  if (!d) return null;
  const ios = isHttpUrl(d.ios) ? d.ios.trim() : "";
  const android = isHttpUrl(d.android) ? d.android.trim() : "";
  return ios || android ? { ios, android } : null;
}

const SAFE_BIO_URL = /^(https?:\/\/|tel:|mailto:)/i;

export function cleanBio(bio) {
  const links = (bio?.links || [])
    .map((l) => ({ label: String(l.label || "").trim().slice(0, 60), url: String(l.url || "").trim() }))
    .filter((l) => l.url && SAFE_BIO_URL.test(l.url))
    .slice(0, 12)
    .map((l) => ({ ...l, label: l.label || l.url }));
  if (!(bio?.title || "").trim()) throw new Error("Give your page a title.");
  if (!links.length) throw new Error("Add at least one valid link (https://, tel: or mailto:).");
  return {
    title: bio.title.trim().slice(0, 60),
    description: (bio.description || "").trim().slice(0, 200),
    accent: /^#[0-9a-f]{6}$/i.test(bio.accent || "") ? bio.accent : "#4f46e5",
    avatar: bio.avatar && bio.avatar.length <= 60000 ? bio.avatar : null,
    links,
  };
}

export const cleanMax = (n) => (Number(n) > 0 ? Math.floor(Number(n)) : null);

/** Strict shape check for the PBKDF2 spec the browser sends ({salt, hash, iter}). */
export function cleanPasswordSpec(p) {
  if (!p || !p.hash) return null;
  const hex = (s, len) => typeof s === "string" && s.length === len && /^[0-9a-f]+$/i.test(s);
  const iter = Number(p.iter);
  if (!hex(p.salt, 32) || !hex(p.hash, 64) || !Number.isInteger(iter) || iter < 10000 || iter > 310000) {
    throw new Error("Invalid password data.");
  }
  return { salt: p.salt.toLowerCase(), hash: p.hash.toLowerCase(), iter };
}
