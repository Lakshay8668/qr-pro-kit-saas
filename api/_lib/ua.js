// api/_lib/ua.js — server-side UA parsing + bot filtering (no dependencies)

export function parseUA(ua = "") {
  const u = ua || "";
  let os = "Other";
  if (/iPhone|iPad|iPod/i.test(u)) os = "iOS";
  else if (/Android/i.test(u)) os = "Android";
  else if (/Windows/i.test(u)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(u)) os = "macOS";
  else if (/CrOS/i.test(u)) os = "ChromeOS";
  else if (/Linux/i.test(u)) os = "Linux";

  let device = "desktop";
  if (/iPad|Tablet/i.test(u) || (os === "Android" && !/Mobile/i.test(u))) device = "tablet";
  else if (/Mobi|iPhone|iPod|Android/i.test(u)) device = "mobile";

  let browser = "Other";
  if (/FBAN|FBAV/i.test(u)) browser = "Facebook app";
  else if (/Instagram/i.test(u)) browser = "Instagram app";
  else if (/WhatsApp/i.test(u)) browser = "WhatsApp";
  else if (/SamsungBrowser/i.test(u)) browser = "Samsung Internet";
  else if (/EdgA?\/|Edg\//i.test(u)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(u)) browser = "Opera";
  else if (/Firefox|FxiOS/i.test(u)) browser = "Firefox";
  else if (/CriOS|Chrome/i.test(u)) browser = "Chrome";
  else if (/Safari/i.test(u)) browser = "Safari";

  return { os, device, browser };
}

// Link-preview fetchers and crawlers shouldn't inflate scan counts.
export const isBot = (ua = "") =>
  !ua ||
  // crawlers announce themselves with "bot/", "+http(s)://" etc. (plain "bot" would also hit phone brands like Cubot)
  /bot\/|bot;|bot\)|\+https?:|crawl|spider|slurp|facebookexternalhit|Slackbot|Twitterbot|LinkedInBot|Discordbot|TelegramBot|HeadlessChrome|curl\/|wget|python-requests|Go-http-client|WhatsApp\/[\d.]+ [AI]|link ?preview/i.test(ua);
