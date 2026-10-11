// src/lib/qrPayloads.js
// Turns form data into the exact string that gets encoded into the QR.

function escapeWifi(value = "") {
  return value.replace(/([\\;,:"])/g, "\\$1");
}

/** Returns true only for absolute http/https URLs. */
export function isValidHttpUrl(str) {
  if (!str || typeof str !== "string") return false;
  try {
    const u = new URL(str.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Adds https:// when the user typed a bare domain. */
export function normalizeUrl(str = "") {
  const s = (str || "").trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/**
 * Validates that a string is a publicly accessible http(s) URL.
 * Rejects local file paths, localhost, private LAN addresses, and malformed strings.
 */
export function validatePublicUrl(raw = "") {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return { ok: false, error: "Please enter a publicly accessible file or menu URL." };
  }

  // Detect local file paths (e.g. file://, C:\, /Users/...)
  if (/^file:\/\//i.test(trimmed) || /^[a-zA-Z]:[\\/]/i.test(trimmed) || trimmed.startsWith("\\\\")) {
    return {
      ok: false,
      error: "Local file paths (such as file:// or C:\\...) cannot be opened by mobile devices scanning the QR code. Please upload the file online (e.g. Google Drive, Dropbox, or your website) and use its public link.",
    };
  }

  const normalized = normalizeUrl(trimmed);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    return {
      ok: false,
      error: "The URL you entered is malformed. Please enter a valid web address (e.g. https://example.com/menu.pdf).",
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "The URL must use HTTP or HTTPS protocol." };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Localhost / loopback checks
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  ) {
    return {
      ok: false,
      error: "This URL points to localhost (this computer only). Phones scanning the QR code will not be able to open it. Please use a publicly accessible URL.",
    };
  }

  // Private network IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  if (
    /^192\.168\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
  ) {
    return {
      ok: false,
      error: "This URL points to a private local Wi-Fi address. Mobile devices outside your local network will not be able to open it. Please use a public internet link.",
    };
  }

  // Must have a valid domain structure (at least one dot in hostname)
  if (!hostname.includes(".")) {
    return {
      ok: false,
      error: `"${hostname}" is not a valid public web domain. Please enter a complete URL (e.g. https://example.com/menu.pdf).`,
    };
  }

  return { ok: true, url: normalized };
}

/** Normalize phone to digits only (optional leading +). */
function digitsPhone(phone = "") {
  return phone.replace(/[^\d+]/g, "");
}

/** Append UTM params to a URL if provided. */
export function withUtm(url, data = {}) {
  if (!url || !isValidHttpUrl(url)) return url;
  try {
    const u = new URL(url);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((k) => {
      if (data[k] && String(data[k]).trim()) u.searchParams.set(k, String(data[k]).trim());
    });
    return u.toString();
  } catch {
    return url;
  }
}

export const QR_TYPES = [
  { id: "url", label: "Website", hint: "Any web link" },
  { id: "whatsapp", label: "WhatsApp", hint: "Chat with a pre-filled message" },
  { id: "pdf", label: "File / Menu (PDF)", hint: "Upload a PDF menu, brochure or image — replaceable later" },
  { id: "bio", label: "Link-in-bio Page", hint: "A mini page with your buttons — every click is tracked" },
  { id: "upi", label: "UPI Payment", hint: "Get paid via GPay / PhonePe / Paytm" },
  { id: "review", label: "Google Review", hint: "Send customers straight to your review box" },
  { id: "map", label: "Location", hint: "Opens Google Maps" },
  { id: "instagram", label: "Instagram", hint: "Profile link" },
  { id: "youtube", label: "YouTube", hint: "Video or channel" },
  { id: "app", label: "App Download", hint: "Smart App Store / Play Store redirect" },
  { id: "vcard", label: "Contact (vCard)", hint: "Saves to phone contacts" },
  { id: "wifi", label: "Wi-Fi", hint: "One-tap network join" },
  { id: "event", label: "Calendar Event", hint: "Adds an event to the calendar" },
  { id: "email", label: "Email", hint: "Pre-filled email" },
  { id: "phone", label: "Phone Call", hint: "Dial a number" },
  { id: "sms", label: "SMS", hint: "Pre-filled text message" },
  { id: "text", label: "Plain Text", hint: "Any text" },
];

function icsDate(s = "") {
  // "2026-10-12T18:30" -> "20261012T183000"
  const v = s.replace(/[-:]/g, "");
  return v.length === 13 ? `${v}00` : v;
}
const icsText = (s = "") => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

export function buildPayload(type, data = {}) {
  switch (type) {
    case "url": {
      const url = normalizeUrl(data.url);
      if (!url || !isValidHttpUrl(url)) return "";
      return withUtm(url, data);
    }

    case "whatsapp": {
      const phone = digitsPhone(data.phone || "");
      if (!phone) return "";
      const msg = (data.message || "").trim();
      const base = `https://wa.me/${phone.replace(/^\+/, "")}`;
      return msg ? `${base}?text=${encodeURIComponent(msg)}` : base;
    }

    case "instagram": {
      const user = (data.username || "").trim().replace(/^@/, "");
      if (!user) return "";
      return `https://instagram.com/${user}`;
    }

    case "youtube": {
      const url = normalizeUrl(data.url);
      return url && isValidHttpUrl(url) ? url : "";
    }

    case "app": {
      // One landing URL is used for the QR; when "editable" is on, iOS/Android
      // phones are sent to their own store automatically (see links.js).
      const url = normalizeUrl(data.url || data.ios || data.android);
      return url && isValidHttpUrl(url) ? url : "";
    }

    case "pdf": {
      const v = validatePublicUrl(data.url);
      return v.ok ? v.url : "";
    }

    case "upi": {
      const pa = (data.pa || "").trim();
      if (!/^[\w.-]{2,}@[\w.-]{2,}$/.test(pa)) return "";
      const parts = [`pa=${pa}`];
      const pn = (data.pn || "").trim();
      if (pn) parts.push(`pn=${encodeURIComponent(pn)}`);
      const am = Number(data.am);
      if (data.am && am > 0) parts.push(`am=${am.toFixed(2)}`);
      parts.push("cu=INR");
      const tn = (data.tn || "").trim();
      if (tn) parts.push(`tn=${encodeURIComponent(tn)}`);
      return `upi://pay?${parts.join("&")}`;
    }

    case "review": {
      const v = (data.placeId || "").trim();
      if (!v) return "";
      if (/^https?:\/\//i.test(v)) return isValidHttpUrl(v) ? v : "";
      return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(v)}`;
    }

    case "map": {
      const q = (data.query || "").trim();
      if (!q) return "";
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
    }

    case "event": {
      const title = (data.title || "").trim();
      if (!title || !data.start) return "";
      const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        `SUMMARY:${icsText(title)}`,
        `DTSTART:${icsDate(data.start)}`,
        `DTEND:${icsDate(data.end || data.start)}`,
        data.location ? `LOCATION:${icsText(data.location)}` : null,
        data.description ? `DESCRIPTION:${icsText(data.description)}` : null,
        "END:VEVENT",
        "END:VCALENDAR",
      ];
      return lines.filter(Boolean).join("\n");
    }

    case "text":
      return (data.text || "").trim();

    case "email": {
      const to = (data.to || "").trim();
      if (!to) return "";
      const params = [];
      if (data.subject) params.push(`subject=${encodeURIComponent(data.subject)}`);
      if (data.body) params.push(`body=${encodeURIComponent(data.body)}`);
      const query = params.length ? `?${params.join("&")}` : "";
      return `mailto:${to}${query}`;
    }

    case "phone": {
      const phone = digitsPhone(data.phone || "");
      return phone ? `tel:${phone}` : "";
    }

    case "sms": {
      const phone = digitsPhone(data.phone || "");
      if (!phone) return "";
      return `SMSTO:${phone}:${data.message || ""}`;
    }

    case "wifi": {
      const ssid = (data.ssid || "").trim();
      if (!ssid) return "";
      return `WIFI:T:${data.security || "WPA"};S:${escapeWifi(ssid)};P:${escapeWifi(
        data.password || ""
      )};${data.hidden ? "H:true;" : ""};`;
    }

    case "vcard": {
      const first = (data.firstName || "").trim();
      const last = (data.lastName || "").trim();
      if (!first && !last) return "";
      return [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `N:${last};${first};;;`,
        `FN:${[first, last].filter(Boolean).join(" ")}`,
        data.org ? `ORG:${data.org}` : null,
        data.title ? `TITLE:${data.title}` : null,
        data.phone ? `TEL;TYPE=CELL:${data.phone}` : null,
        data.email ? `EMAIL:${data.email}` : null,
        data.website ? `URL:${data.website}` : null,
        "END:VCARD",
      ]
        .filter(Boolean)
        .join("\n");
    }

    default:
      return "";
  }
}

export const REQUIRED_HINT = {
  pdf: "Enter a publicly accessible PDF or menu link (e.g. https://example.com/menu.pdf).",
  bio: "Add a page title and at least one link.",
  url: "Enter a website address.",
  whatsapp: "Enter a phone number with country code.",
  upi: "Enter a valid UPI ID like name@bank.",
  review: "Paste your Google Place ID or review link.",
  map: "Enter an address or place name.",
  instagram: "Enter an Instagram username.",
  youtube: "Enter a YouTube link.",
  app: "Enter a landing, App Store or Play Store link.",
  vcard: "Enter at least a first or last name.",
  wifi: "Enter the Wi-Fi network name.",
  event: "Enter an event title and start time.",
  email: "Enter an email address.",
  phone: "Enter a phone number.",
  sms: "Enter a phone number.",
  text: "Enter some text.",
};

// Types whose payload is an http(s) URL can be "editable" (dynamic): the QR
// holds a short /q/<id> link and you can change the destination any time.
export const DYNAMIC_TYPES = ["url", "whatsapp", "instagram", "youtube", "app", "map", "review", "pdf"];
export const SUPPORTS_DYNAMIC = (type) => DYNAMIC_TYPES.includes(type);

// These types ALWAYS need a saved server-rendered page, so "editable" is forced on.
export const SERVER_TYPES = ["bio"];
export const isServerType = (type) => SERVER_TYPES.includes(type);

/** Destination (+ optional per-OS store links) for creating an editable link. */
export function getDynamicDestinations(type, data = {}) {
  const destination = buildPayload(type, data);
  let destinations = null;
  if (type === "app") {
    const ios = normalizeUrl(data.ios);
    const android = normalizeUrl(data.android);
    destinations = {
      ios: isValidHttpUrl(ios) ? ios : "",
      android: isValidHttpUrl(android) ? android : "",
    };
  }
  return { destination, destinations };
}
