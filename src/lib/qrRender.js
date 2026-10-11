// src/lib/qrRender.js
// One renderer for everything: live preview, PNG download, SVG download and
// the dashboard thumbnails all come from the SAME SVG string, so what you see
// is exactly what you download (v3 had a preview/download mismatch for frames).
//
// Supports: dot shapes, eye (finder) styles, gradient, logo cut-out, frame bar/text.

import QRCode from "qrcode";

export const DEFAULT_DESIGN = {
  fg: "#111827",
  fg2: "", // optional 2nd colour => gradient
  bg: "#ffffff",
  eyeColor: "", // optional separate colour for the 3 corner eyes
  shape: "square", // square | rounded | dots
  eye: "square", // square | rounded | circle
  logo: null, // data URL
  logoScale: 0.22, // logo side as fraction of the QR width (0.12 - 0.30)
  frameStyle: "none", // none | text | bar
  frameText: "Scan me",
};

export const SHAPES = [
  { id: "square", label: "Square" },
  { id: "rounded", label: "Rounded" },
  { id: "dots", label: "Dots" },
];

export const EYES = [
  { id: "square", label: "Square" },
  { id: "rounded", label: "Rounded" },
  { id: "circle", label: "Circle" },
];

const QUIET = 3; // quiet-zone in modules

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
const f = (n) => Math.round(n * 1000) / 1000;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function rrPath(x, y, w, h, r) {
  return (
    `M${f(x + r)} ${f(y)}h${f(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}v${f(h - 2 * r)}` +
    `a${r} ${r} 0 0 1 ${-r} ${r}h${f(-(w - 2 * r))}a${r} ${r} 0 0 1 ${-r} ${-r}` +
    `v${f(-(h - 2 * r))}a${r} ${r} 0 0 1 ${r} ${-r}z`
  );
}

function circlePath(cx, cy, r) {
  return `M${f(cx - r)} ${f(cy)}a${r} ${r} 0 1 0 ${f(2 * r)} 0a${r} ${r} 0 1 0 ${f(-2 * r)} 0z`;
}

/** Throws if the text is too long for a QR code. */
function getMatrix(value, ecl) {
  const qr = QRCode.create(String(value), { errorCorrectionLevel: ecl });
  const n = qr.modules.size;
  return { n, dark: (r, c) => !!qr.modules.get(r, c) };
}

/** Builds the full SVG markup. `size` = width in px (height follows the frame). */
export function buildQrSvg(value, design = {}, { size = 512 } = {}) {
  const d = { ...DEFAULT_DESIGN, ...design };
  const hasLogo = !!d.logo;
  const { n, dark } = getMatrix(value, hasLogo ? "H" : "M");
  const m = QUIET;
  const W = n + m * 2;

  const framed = d.frameStyle !== "none" && (d.frameText || "").trim();
  const band = framed ? W * 0.17 : 0;
  const H = W + band;

  const grad = !!d.fg2 && d.fg2.toLowerCase() !== d.fg.toLowerCase();
  const fill = grad ? "url(#qg)" : d.fg;
  const eyeFill = d.eyeColor || fill;

  // Logo geometry (centred in the QR square)
  const logoSide = hasLogo ? n * clamp(Number(d.logoScale) || 0.22, 0.12, 0.3) : 0;
  const lx = (W - logoSide) / 2;
  const ly = (W - logoSide) / 2;
  const clear = 0.9; // empty margin around logo, in modules
  const inLogo = (r, c) =>
    hasLogo &&
    c + m + 0.5 > lx - clear &&
    c + m + 0.5 < lx + logoSide + clear &&
    r + m + 0.5 > ly - clear &&
    r + m + 0.5 < ly + logoSide + clear;

  const isFinder = (r, c) =>
    (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

  // ---- data modules
  let path = "";
  for (let r = 0; r < n; r++) {
    if (d.shape === "square") {
      // merge horizontal runs => small file, no hairline gaps
      let c = 0;
      while (c < n) {
        if (dark(r, c) && !isFinder(r, c) && !inLogo(r, c)) {
          let e = c;
          while (e + 1 < n && dark(r, e + 1) && !isFinder(r, e + 1) && !inLogo(r, e + 1)) e++;
          path += `M${c + m} ${r + m}h${e - c + 1}v1h${-(e - c + 1)}z`;
          c = e + 1;
        } else c++;
      }
    } else {
      for (let c = 0; c < n; c++) {
        if (!dark(r, c) || isFinder(r, c) || inLogo(r, c)) continue;
        const x = c + m;
        const y = r + m;
        path +=
          d.shape === "dots"
            ? circlePath(x + 0.5, y + 0.5, 0.45)
            : rrPath(x + 0.04, y + 0.04, 0.92, 0.92, 0.3);
      }
    }
  }

  // ---- eyes
  const eyeR = { square: [0, 0], rounded: [1.7, 0.9], circle: [3, 1.5] }[d.eye] || [0, 0];
  const eyes = [
    [m, m],
    [m + n - 7, m],
    [m, m + n - 7],
  ]
    .map(
      ([ox, oy]) =>
        `<rect x="${ox + 0.5}" y="${oy + 0.5}" width="6" height="6" rx="${eyeR[0]}" fill="none" stroke="${eyeFill}" stroke-width="1"/>` +
        `<rect x="${ox + 2}" y="${oy + 2}" width="3" height="3" rx="${eyeR[1]}" fill="${eyeFill}"/>`
    )
    .join("");

  // ---- logo
  let logoSvg = "";
  if (hasLogo) {
    const p = 0.5;
    logoSvg =
      `<rect x="${f(lx - p)}" y="${f(ly - p)}" width="${f(logoSide + 2 * p)}" height="${f(logoSide + 2 * p)}" rx="1" fill="${esc(d.bg)}"/>` +
      `<image href="${esc(d.logo)}" xlink:href="${esc(d.logo)}" x="${f(lx)}" y="${f(ly)}" width="${f(logoSide)}" height="${f(logoSide)}" preserveAspectRatio="xMidYMid meet"/>`;
  }

  // ---- frame
  let frameSvg = "";
  if (framed) {
    const text = esc(d.frameText.trim().slice(0, 24));
    if (d.frameStyle === "bar") {
      const barH = W * 0.12;
      const barW = W - m * 2;
      const fs = Math.min(barH * 0.52, (barW * 0.9) / (text.length * 0.62 || 1));
      frameSvg =
        `<rect x="${m}" y="${f(W)}" width="${barW}" height="${f(barH)}" rx="1.2" fill="${esc(d.fg)}"/>` +
        `<text x="${f(W / 2)}" y="${f(W + barH / 2)}" fill="${esc(d.bg)}" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="${f(fs)}" text-anchor="middle" dominant-baseline="central">${text}</text>`;
    } else {
      const fs = Math.min(band * 0.46, ((W - m * 2) * 0.9) / (text.length * 0.62 || 1));
      frameSvg = `<text x="${f(W / 2)}" y="${f(W + band / 2 - 0.5)}" fill="${esc(d.fg)}" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="${f(fs)}" text-anchor="middle" dominant-baseline="central">${text}</text>`;
    }
  }

  const defs = grad
    ? `<defs><linearGradient id="qg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="${W}"><stop offset="0" stop-color="${esc(d.fg)}"/><stop offset="1" stop-color="${esc(d.fg2)}"/></linearGradient></defs>`
    : "";

  const pxW = size;
  const pxH = Math.round((size * H) / W);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${f(W)} ${f(H)}" width="${pxW}" height="${pxH}">` +
    defs +
    `<rect width="${f(W)}" height="${f(H)}" fill="${esc(d.bg)}"/>` +
    `<path d="${path}" fill="${fill}"${d.shape === "square" ? ' shape-rendering="crispEdges"' : ""}/>` +
    eyes +
    logoSvg +
    frameSvg +
    `</svg>`
  );
}

export function svgSize(svg) {
  const w = /width="([\d.]+)"/.exec(svg)?.[1];
  const h = /height="([\d.]+)"/.exec(svg)?.[1];
  return { width: Number(w) || 512, height: Number(h) || 512 };
}

export const svgToDataUrl = (svg) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

/** Rasterise the SVG to a PNG Blob (browser only). */
export async function svgToPngBlob(svg) {
  const { width, height } = svgSize(svg);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error("Could not render the QR image."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("PNG export failed."))), "image/png")
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const downloadSvgString = (svg, filename) =>
  downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), filename);

// ---------- scan-quality helpers ----------
function lum(hex) {
  const h = (hex || "#000000").replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Returns a list of human-readable warnings about scannability. */
export function scanWarnings(design, payload = "") {
  const d = { ...DEFAULT_DESIGN, ...design };
  const out = [];
  const colours = [d.fg, d.fg2].filter(Boolean);
  const worst = Math.min(...colours.map((c) => contrastRatio(c, d.bg)));
  if (lum(d.fg) > lum(d.bg)) out.push("Light code on a dark background (inverted) — many scanners can't read this. Use a dark code on a light background.");
  else if (worst < 3) out.push(`Low contrast (${worst.toFixed(1)}:1). Aim for 4:1 or higher so cameras can read it.`);
  if (d.logo && Number(d.logoScale) > 0.26) out.push("Logo is large — keep it under ~25% of the QR width and test-scan before printing.");
  if (d.eye !== "square") out.push("Rounded/circle corner eyes look great but a few older scanner apps are pickier — test with your phone (and a second phone) before printing.");
  if (payload.length > 350) out.push("Lots of data in this QR makes it dense and hard to scan. Use an editable (short) link instead.");
  return out;
}

export const MAX_LOGO_BYTES = 5 * 1024 * 1024; // 5 MB

/** Downscale an uploaded logo client-side so it stays compact and fast to render inside SVG/PNG. */
export function fileToSmallLogo(file, max = 200) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("No image file provided."));
    if (!file.type || !file.type.startsWith("image/")) {
      return reject(new Error("Please select a valid image file (PNG, JPG, WebP, SVG, or GIF)."));
    }
    if (file.size > MAX_LOGO_BYTES) {
      return reject(new Error("Logo image must be smaller than 5 MB."));
    }

    let objectUrl;
    try {
      objectUrl = URL.createObjectURL(file);
    } catch {
      // Fallback for environments where createObjectURL is unavailable
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read the image."));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Could not decode image."));
        img.onload = () => {
          const nw = img.naturalWidth || img.width || 1;
          const nh = img.naturalHeight || img.height || 1;
          const k = Math.min(1, max / Math.max(nw, nh));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(nw * k));
          c.height = Math.max(1, Math.round(nh * k));
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL("image/png"));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
      return;
    }

    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const nw = img.naturalWidth || img.width || 1;
        const nh = img.naturalHeight || img.height || 1;
        const k = Math.min(1, max / Math.max(nw, nh));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(nw * k));
        c.height = Math.max(1, Math.round(nh * k));
        const ctx = c.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/png"));
      } catch (err) {
        reject(new Error(`Failed to process image: ${err?.message || "render error"}`));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not decode the selected image. The file may be corrupt or an unsupported format."));
    };
    img.src = objectUrl;
  });
}

