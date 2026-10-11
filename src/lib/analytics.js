// src/lib/analytics.js — turns raw scan documents into dashboard numbers + CSV.

const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function tally(items, key, top = 6) {
  const m = new Map();
  items.forEach((s) => {
    const k = s[key] || "Unknown";
    m.set(k, (m.get(k) || 0) + 1);
  });
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([label, count]) => ({ label, count }));
}

let regionNames = null;
const countryName = (cc) => {
  if (!cc) return "Unknown";
  try {
    regionNames = regionNames || new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(cc) || cc;
  } catch {
    return cc;
  }
};

export function summarize(all, days = 14) {
  // Link-in-bio button taps are logged as ev:"click"; everything else is a scan.
  const clicks = all.filter((s) => s.ev === "click");
  const scans = all.filter((s) => s.ev !== "click").map((s) => ({ ...s, countryName: countryName(s.country), cityName: s.city ? `${s.city}${s.country ? `, ${s.country}` : ""}` : "" }));
  const now = Date.now();
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);

  const byDayMap = new Map();
  scans.forEach((s) => byDayMap.set(dayKey(s.t), (byDayMap.get(dayKey(s.t)) || 0) + 1));

  const byDay = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    byDay.push({
      label: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      count: byDayMap.get(dayKey(d.getTime())) || 0,
    });
  }

  const byHour = Array.from({ length: 24 }, (_, h) => ({ label: String(h), count: 0 }));
  scans.forEach((s) => {
    byHour[new Date(s.t).getHours()].count++;
  });

  return {
    total: scans.length,
    unique: new Set(scans.map((s) => s.vid).filter(Boolean)).size,
    today: scans.filter((s) => s.t >= startToday.getTime()).length,
    last7: scans.filter((s) => s.t >= now - 7 * 86400000).length,
    byDevice: tally(scans, "device"),
    byOS: tally(scans, "os"),
    byBrowser: tally(scans, "browser"),
    byTz: tally(scans, "tz", 5),
    byCountry: tally(scans.filter((s) => s.country), "countryName", 6),
    byCity: tally(scans.filter((s) => s.cityName), "cityName", 6),
    topLinks: tally(clicks, "target", 8),
    clicks: clicks.length,
    byLang: tally(scans, "lang", 5),
    byDay,
    byHour,
  };
}

export function scansToCsv(scans) {
  const head = ["time", "event", "button", "country", "region", "city", "device", "os", "browser", "language", "timezone", "visitor"];
  const rows = scans.map((s) =>
    [new Date(s.t).toISOString(), s.ev || "scan", s.target, s.country, s.region, s.city, s.device, s.os, s.browser, s.lang, s.tz, s.vid].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")
  );
  return [head.join(","), ...rows].join("\n");
}
