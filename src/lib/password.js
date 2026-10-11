// src/lib/password.js
// Hash a QR password in the browser (PBKDF2-SHA256, 100k iterations, random salt).
// Only {salt, hash, iter} is stored — never the password. The Vercel function
// re-derives with the same parameters to verify (api/_lib/handler.js).

const toHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function hashPassword(password, iter = 100000) {
  if (!password || password.length < 4) throw new Error("Password must be at least 4 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256);
  return { salt: toHex(salt), hash: toHex(new Uint8Array(bits)), iter };
}
