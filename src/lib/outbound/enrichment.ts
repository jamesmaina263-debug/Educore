// Contact enrichment helpers: find a school's website/phone/email/head teacher WITHOUT inventing
// anything. Pure functions only (no network); the fetching lives in safe-fetch.ts and the server
// action. Principle: a value is only kept if it provably appears on a page we fetched ourselves.
// The LLM is used to LOCATE pages, never trusted as the source of a phone number or email.

import { normalizePhone, normalizeWebsite } from "./prospects";

export const MAX_ENRICH_BATCH = 5;

/**
 * SSRF guard for every URL we fetch server-side (the URLs can come from the web or from an LLM):
 * http(s) only, no credentials, standard ports, no IP literals, no single-label or internal-looking
 * hostnames.
 */
export function isSafePublicUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== "80" && u.port !== "443") return false;
  const h = u.hostname.toLowerCase();
  if (h.startsWith("[") || h.includes(":")) return false; // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false; // IPv4 literal
  if (h === "localhost" || /\.(local|localhost|internal|lan|home|corp)$/.test(h)) return false;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z][a-z0-9-]*$/.test(h);
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const IMAGE_TLDS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "css", "js", "ico", "woff", "woff2"]);
const JUNK_EMAIL_DOMAINS = new Set([
  "example.com", "domain.com", "email.com", "yourdomain.com", "sentry.io", "wixpress.com", "sentry-next.wixpress.com",
]);
const JUNK_EMAIL_LOCALS = new Set(["you", "name", "email", "yourname", "your", "user", "username", "test", "info@example"]);

function isPlausibleEmail(email: string): boolean {
  const e = email.toLowerCase();
  if (e.length > 254) return false;
  const [local, domain] = e.split("@");
  if (!local || !domain) return false;
  const tld = domain.split(".").pop() ?? "";
  if (IMAGE_TLDS.has(tld)) return false;
  if (JUNK_EMAIL_DOMAINS.has(domain) || JUNK_EMAIL_LOCALS.has(local)) return false;
  return true;
}

/** Visible text of an HTML page (scripts/styles/tags removed, a few entities decoded). */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#0?64;|&commat;/gi, "@")
    .replace(/\s+/g, " ")
    .trim();
}

const KE_PHONE_RE = /(?:\+?254|0)[\s.-]?[17]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}/g;

export type ExtractedContacts = { emails: string[]; phones: string[] };

/** mailto:/tel: links first (most reliable), then emails and Kenyan-format numbers in visible text. */
export function extractContactsFromHtml(html: string): ExtractedContacts {
  const emails: string[] = [];
  const phones: string[] = [];
  const addEmail = (raw: string) => {
    const e = raw.trim().toLowerCase();
    if (isPlausibleEmail(e) && !emails.includes(e)) emails.push(e);
  };
  const addPhone = (raw: string) => {
    const p = normalizePhone(raw);
    if (p && !phones.includes(p)) phones.push(p);
  };

  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    try {
      addEmail(decodeURIComponent(m[1]));
    } catch {
      addEmail(m[1]);
    }
  }
  for (const m of html.matchAll(/tel:([+\d()\s.%-]+)/gi)) {
    try {
      addPhone(decodeURIComponent(m[1]));
    } catch {
      addPhone(m[1]);
    }
  }

  const text = htmlToText(html);
  for (const m of text.matchAll(EMAIL_RE)) addEmail(m[0]);
  for (const m of text.matchAll(KE_PHONE_RE)) addPhone(m[0]);
  return { emails, phones };
}

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Prefer an email on the school's own domain; otherwise the first one found on its own pages. */
export function pickBestEmail(emails: string[], website: string | null): string | null {
  if (emails.length === 0) return null;
  const host = website ? hostOf(website) : "";
  if (host) {
    const own = emails.find((e) => {
      const d = e.split("@")[1];
      return d === host || d.endsWith(`.${host}`) || host.endsWith(`.${d}`);
    });
    if (own) return own;
  }
  return emails[0];
}

// ---------------------------------------------------------------------------------------------
// AI web-search lookup (Gemini + Google Search grounding)
// ---------------------------------------------------------------------------------------------

export type FoundContacts = {
  website: string | null;
  phone: string | null;
  email: string | null;
  contact_name: string | null;
  contact_role: string | null;
  source_url: string | null;
};

export type EnrichmentTarget = {
  school_name: string;
  town_county: string | null;
  school_level: string | null;
  website: string | null;
};

export function buildEnrichmentPrompt(p: EnrichmentTarget): string {
  const facts = [
    `School name: ${p.school_name}`,
    p.town_county ? `Location: ${p.town_county}, Kenya` : "Location: Kenya",
    p.school_level ? `Level: ${p.school_level}` : null,
    p.website ? `Known website: ${p.website}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `Use Google Search to find OFFICIAL public contact details for this Kenyan school.

${facts}

Find: the school's official website, its main office phone number, its official office email address, and the name and role of its head teacher or principal if published.

Rules:
- Only report details that appear on a web page you actually found. Never guess, never construct an email address from a pattern, never use a number from memory.
- Prefer the school's own website or an official directory. Office or administration contacts only; skip personal-looking numbers.
- "source_url" must be the exact page where the phone/email/name appears.
- If you are not sure it is the same school (name AND location), return null for everything.

Return ONLY a JSON object, no markdown:
{"website": string|null, "phone": string|null, "email": string|null, "contact_name": string|null, "contact_role": string|null, "source_url": string|null}`;
}

export type ParseEnrichmentResult = { ok: true; value: FoundContacts } | { ok: false; error: string };

const nullIfBlank = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() && v.trim().length <= max && v.trim().toLowerCase() !== "null" ? v.trim() : null;

function extractJsonObject(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("no JSON object");
  }
}

/** Shape-validates the model output. Phone/email/name are dropped when there is no usable source_url. */
export function parseEnrichmentResponse(raw: string): ParseEnrichmentResult {
  let data: unknown;
  try {
    data = extractJsonObject(raw);
  } catch {
    return { ok: false, error: "The search result wasn't valid JSON." };
  }
  if (!data || typeof data !== "object") return { ok: false, error: "The search result had an unexpected shape." };
  const o = data as Record<string, unknown>;

  const sourceRaw = nullIfBlank(o.source_url, 500);
  const source_url = sourceRaw && isSafePublicUrl(sourceRaw) ? sourceRaw : null;

  const websiteRaw = nullIfBlank(o.website, 300);
  const website = websiteRaw ? normalizeWebsite(websiteRaw) : null;

  const emailRaw = nullIfBlank(o.email, 254)?.toLowerCase() ?? null;
  const email = emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailRaw) && isPlausibleEmail(emailRaw) ? emailRaw : null;

  const phoneRaw = nullIfBlank(o.phone, 40);
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;

  return {
    ok: true,
    value: {
      website,
      source_url,
      // Without a source page there is nothing to verify against, so these are unusable.
      phone: source_url ? phone : null,
      email: source_url ? email : null,
      contact_name: source_url ? nullIfBlank(o.contact_name, 200) : null,
      contact_role: source_url ? nullIfBlank(o.contact_role, 100) : null,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Verification against fetched page text. This is what makes AI-found contacts trustworthy.
// ---------------------------------------------------------------------------------------------

export function pageContainsEmail(pageText: string, email: string): boolean {
  return pageText.toLowerCase().includes(email.toLowerCase());
}

/** Matches on the last 9 digits so +254 712 345 678, 0712345678 and 0712-345-678 are all equal. */
export function pageContainsPhone(pageText: string, phone: string): boolean {
  const want = phone.replace(/\D/g, "").slice(-9);
  if (want.length < 7) return false;
  for (const m of pageText.matchAll(/\+?\d[\d\s().-]{5,}\d/g)) {
    if (m[0].replace(/\D/g, "").slice(-9) === want) return true;
  }
  return false;
}

export function pageContainsName(pageText: string, name: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const n = norm(name);
  return n.length >= 4 && norm(pageText).includes(n);
}

const GENERIC_NAME_WORDS = new Set([
  "the", "of", "and", "school", "schools", "academy", "primary", "secondary", "junior", "senior", "high",
  "nursery", "kindergarten", "preschool", "pre", "girls", "boys", "mixed", "day", "boarding", "centre",
  "center", "education", "college", "institute", "st", "saint", "kenya", "county",
]);

/** Does this page plausibly belong to this school? At least half of its distinctive words must appear. */
export function nameMatchesPage(schoolName: string, pageText: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const text = ` ${norm(pageText)} `;
  const words = norm(schoolName)
    .split(" ")
    .filter((w) => w.length >= 3 && !GENERIC_NAME_WORDS.has(w));
  if (words.length === 0) return text.includes(` ${norm(schoolName)} `);
  const hits = words.filter((w) => text.includes(` ${w} `) || text.includes(` ${w}`)).length;
  return hits >= Math.ceil(words.length / 2);
}

/**
 * Keeps only what is provably on the pages we fetched. sourceText = the text of source_url;
 * websiteText = the text of a website the model proposed (to confirm it is really this school).
 */
export function verifyFoundContacts(
  found: FoundContacts,
  sourceText: string | null,
  websiteText: string | null,
  schoolName: string,
): FoundContacts {
  const text = sourceText ?? "";
  return {
    source_url: sourceText ? found.source_url : null,
    phone: sourceText && found.phone && pageContainsPhone(text, found.phone) ? found.phone : null,
    email: sourceText && found.email && pageContainsEmail(text, found.email) ? found.email : null,
    contact_name: sourceText && found.contact_name && pageContainsName(text, found.contact_name) ? found.contact_name : null,
    contact_role: sourceText && found.contact_name && pageContainsName(text, found.contact_name) ? found.contact_role : null,
    website: found.website && websiteText && nameMatchesPage(schoolName, websiteText) ? found.website : null,
  };
}
