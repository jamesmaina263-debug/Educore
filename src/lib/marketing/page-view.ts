// Pure helpers for the first-party page-view counter (see the migration
// 20261017200000_first_party_page_views.sql for the table and what it does and does not store).
//
// Everything here is deliberately defensive: the counter's endpoint is public and unauthenticated,
// so the body is treated as hostile input. Only a short, clean path and a handful of campaign tags
// ever reach the database; anything else is dropped or replaced with null. The ad click id itself
// (gclid/fbclid...) never leaves the visitor's browser -- the browser only reports WHICH network's
// id was present.

/** Raw page views older than this are deleted by the daily retention cron. */
export const PAGE_VIEW_RETENTION_DAYS = 90;

/** The beacon body is a few hundred bytes; anything bigger is not ours. */
export const PAGE_VIEW_MAX_BODY_BYTES = 2048;

export type ClickPlatform = "google" | "meta";
export type DeviceClass = "mobile" | "tablet" | "desktop" | "unknown";

export type PageViewInput = {
  path: string;
  /** True for the first page view after a full page load (the landing page of a visit). */
  isEntry: boolean;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  clickPlatform: ClickPlatform | null;
};

const MAX_PATH_LENGTH = 200;
const SAFE_PATH = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/;
// Routes that exist but are not part of the public marketing site. The beacon is never mounted on
// them; this just stops a hand-made request from filling the table with them.
const NOT_COUNTED_FIRST_SEGMENTS = new Set(["api", "admin", "_next"]);

/** Path only: query string and fragment removed, lowercased, trailing slash dropped. */
export function cleanPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let path = raw.split("#")[0].split("?")[0].trim();
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (path.length > 1) path = path.replace(/\/+$/, "") || "/";
  path = path.toLowerCase();
  if (path.length > MAX_PATH_LENGTH || !SAFE_PATH.test(path)) return null;
  const first = path.split("/").filter(Boolean)[0];
  if (first && NOT_COUNTED_FIRST_SEGMENTS.has(first)) return null;
  return path;
}

function stripWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/** Host of the referring page, or null when it is empty, unparseable, or our own site. */
export function cleanReferrerHost(raw: unknown, ownHost: string | null): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    return null;
  }
  host = stripWww(host);
  if (!host || host.length > 100) return null;
  if (ownHost && host === stripWww(ownHost).split(":")[0]) return null;
  return host;
}

/** A campaign tag from the landing URL: control characters removed, trimmed, capped at 100. */
export function cleanTag(raw: unknown, lower = false): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (lower) value = value.toLowerCase();
  return value ? value.slice(0, 100) : null;
}

/** Which ad network's click id is on the landing URL. Used by the browser; the id is never sent. */
export function clickPlatformFromSearch(params: URLSearchParams): ClickPlatform | null {
  if (params.has("gclid") || params.has("gbraid") || params.has("wbraid")) return "google";
  if (params.has("fbclid")) return "meta";
  return null;
}

/** Validates the beacon body. Campaign data is only trusted on a landing (entry) view. */
export function parsePageViewPayload(body: unknown, ownHost: string | null): PageViewInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const path = cleanPath(b.path);
  if (!path) return null;
  const isEntry = b.isEntry === true;
  return {
    path,
    isEntry,
    referrerHost: isEntry ? cleanReferrerHost(b.referrer, ownHost) : null,
    utmSource: isEntry ? cleanTag(b.utmSource, true) : null,
    utmMedium: isEntry ? cleanTag(b.utmMedium, true) : null,
    utmCampaign: isEntry ? cleanTag(b.utmCampaign) : null,
    clickPlatform: isEntry && (b.click === "google" || b.click === "meta") ? b.click : null,
  };
}

export function deviceFromUserAgent(ua: string | null | undefined): DeviceClass {
  if (!ua) return "unknown";
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
    return "tablet";
  }
  if (/Mobi|iPhone|iPod|Android|Windows Phone|BlackBerry|Opera Mini/i.test(ua)) return "mobile";
  return "desktop";
}

const BOT_USER_AGENT =
  /bot|crawl|spider|slurp|facebookexternalhit|facebot|headless|lighthouse|pingdom|uptimerobot|statuscake|datadog|gtmetrix|pagespeed|vercel|curl\/|wget|python-requests|python-urllib|httpclient|go-http-client|java\/|libwww|scrapy|phantomjs|selenium|puppeteer|playwright/i;
// "Cubot" is a phone brand sold in Kenya; its user agent contains "bot".
const BOT_LOOKALIKES = /cubot/i;

/** Automated traffic that happens to run JavaScript. Real browsers always send a real user agent. */
export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua || ua.trim().length < 10) return true;
  if (BOT_LOOKALIKES.test(ua)) return false;
  return BOT_USER_AGENT.test(ua);
}

/** Two-letter country from the CDN's geo header; null when absent or Vercel's "unknown" markers. */
export function countryFromHeader(value: string | null | undefined): string | null {
  const code = (value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== "XX" && code !== "T1" ? code : null;
}
