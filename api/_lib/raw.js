// api/_lib/raw.js — webhooks must be verified against the EXACT bytes the provider sent,
// so the webhook functions turn Vercel's body parser off and read the stream themselves.
export async function readRaw(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  // If the platform already parsed the JSON, the original bytes are gone and the signature can't be checked.
  // Fail loudly (500 -> provider retries, and the log tells you why) instead of hanging on a drained stream.
  if ((req.body && typeof req.body === "object") || req.readableEnded) {
    throw new Error("webhook body was already consumed — make sure `export const config = { api: { bodyParser: false } }` is active");
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 1_000_000) { reject(new Error("body too large")); req.destroy?.(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
