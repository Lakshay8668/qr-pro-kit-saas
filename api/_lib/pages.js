// api/_lib/pages.js — tiny server-rendered HTML pages (status, password, link-in-bio)

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const okColor = (c, d = "#4f46e5") => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : d);

export const SAFE_SCHEMES = /^(https?:|tel:|mailto:)/i;

function layout(title, body, accent = "#4f46e5") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
:root{--a:${okColor(accent)};--bg:#f5f7fb;--fg:#111827;--card:#fff;--mut:#6b7280;--bd:#e5e7eb}
@media(prefers-color-scheme:dark){:root{--bg:#0f172a;--fg:#f1f5f9;--card:#1e293b;--mut:#94a3b8;--bd:#334155}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg);color:var(--fg);font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.card{width:100%;max-width:420px;background:var(--card);border:1px solid var(--bd);border-radius:22px;padding:28px 24px;text-align:center;box-shadow:0 10px 35px rgba(0,0,0,.08)}
h1{font-size:20px;margin:0 0 8px}p{color:var(--mut);line-height:1.5;margin:6px 0}
input{width:100%;padding:13px;border:1px solid var(--bd);border-radius:12px;font:inherit;margin:14px 0 10px;background:transparent;color:var(--fg)}
button,.btn{display:block;width:100%;padding:14px 16px;border:0;border-radius:14px;background:var(--a);color:#fff;font:inherit;font-weight:700;text-decoration:none;cursor:pointer;margin:10px 0}
.err{color:#dc2626;font-size:14px}.av{width:84px;height:84px;border-radius:50%;object-fit:cover;border:3px solid var(--a);margin-bottom:10px}
.btn.alt{background:transparent;color:var(--a);border:2px solid var(--a)}footer{margin-top:18px;font-size:11px;color:var(--mut)}
</style></head><body>${body}</body></html>`;
}

export function messagePage(title, text) {
  return layout(title, `<div class="card"><h1>${esc(title)}</h1><p>${esc(text)}</p></div>`);
}

export function passwordPage({ error = "" } = {}) {
  return layout(
    "Password required",
    `<div class="card"><h1>🔒 Password required</h1><p>This QR code is protected. Enter the password to continue.</p>
<form method="POST" autocomplete="off"><input type="password" name="password" placeholder="Password" required autofocus>
${error ? `<div class="err">${esc(error)}</div>` : ""}<button type="submit">Continue</button></form></div>`
  );
}

export function bioPage(id, bio = {}) {
  const accent = okColor(bio.accent);
  const links = Array.isArray(bio.links) ? bio.links.slice(0, 12) : [];
  const av = typeof bio.avatar === "string" && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(bio.avatar) ? bio.avatar : "";
  const buttons = links
    .map((l, i) => {
      const url = String(l?.url || "");
      if (!SAFE_SCHEMES.test(url)) return "";
      const href = /^https?:/i.test(url) ? `/q/${encodeURIComponent(id)}?go=${i}` : esc(url);
      return `<a class="btn${i % 2 ? " alt" : ""}" href="${href}" rel="noopener">${esc(String(l.label || url).slice(0, 60))}</a>`;
    })
    .join("");
  return layout(
    bio.title || "Links",
    `<div class="card">${av ? `<img class="av" src="${esc(av)}" alt="">` : ""}<h1>${esc(bio.title || "Links")}</h1>
${bio.description ? `<p>${esc(bio.description)}</p>` : ""}${buttons}</div>`,
    accent
  );
}
