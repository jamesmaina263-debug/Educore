// Single definition of which marketing-attribution fields EduCore captures and
// how each one is sanitised. Deliberately has no "use client" / "use server"
// directive so both sides can import it: the browser capture in
// src/lib/attribution.ts and the server actions that persist the values
// (contact/actions.ts, lead-magnet-actions.ts, signup/actions.ts).
//
// Two kinds of field:
//   - UTM tags (utm_source, ...): campaign labels we put on our own ad links.
//   - Ad click IDs (gclid, gbraid, wbraid): identifiers Google Ads appends to
//     the landing URL when auto-tagging is on. Storing one next to a lead or a
//     signup is what later lets a paid customer be reported back to Google Ads
//     as an offline conversion. These are only captured when the visitor has
//     not declined cookies (see consent.ts and attribution.ts).

export const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

export const CLICK_ID_KEYS = ["gclid", "gbraid", "wbraid"] as const;

export const ATTRIBUTION_KEYS = [...UTM_KEYS, ...CLICK_ID_KEYS] as const;

export type AttributionKey = (typeof ATTRIBUTION_KEYS)[number];

/** What the browser keeps in sessionStorage: only the keys actually seen. */
export type Attribution = Partial<Record<AttributionKey, string>>;

/** What a server action inserts: every key present, null when not provided. */
export type AttributionColumns = Record<AttributionKey, string | null>;

// The three columns that existed on marketing_demo_requests / marketing_leads
// before the Google Ads readiness migration. Used by the insert fallback below.
const LEGACY_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;

// Google click IDs are URL-safe tokens (letters, digits, "_" and "-"). Anything
// else is not a real click ID and is dropped rather than stored.
const CLICK_ID_RE = /^[\w-]{1,200}$/;

export function isClickIdKey(key: AttributionKey): boolean {
  return (CLICK_ID_KEYS as readonly string[]).includes(key);
}

/**
 * Trims and validates one value. Returns null for "not provided / not valid".
 * UTM values are free text, so they are length-capped exactly as before
 * (100 chars); click IDs must match the token shape above.
 */
export function sanitizeAttributionValue(key: AttributionKey, raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (isClickIdKey(key)) return CLICK_ID_RE.test(value) ? value : null;
  return value.slice(0, 100);
}

/**
 * Reads every attribution field out of a submitted form. The values come from
 * hidden inputs filled by browser code, so they are treated as untrusted:
 * they only ever label which channel gets credit, never gate a submission.
 */
export function parseAttributionFormData(formData: FormData): AttributionColumns {
  const out = {} as AttributionColumns;
  for (const key of ATTRIBUTION_KEYS) {
    out[key] = sanitizeAttributionValue(key, formData.get(key));
  }
  return out;
}

/** Just the three columns every environment already has. */
export function legacyAttributionColumns(columns: AttributionColumns) {
  const out = {} as Pick<AttributionColumns, (typeof LEGACY_KEYS)[number]>;
  for (const key of LEGACY_KEYS) out[key] = columns[key];
  return out;
}

/**
 * True when a PostgREST/Postgres error means "a column in this insert does not
 * exist (yet)". The new attribution columns arrive via a migration that the
 * deploy workflow applies on merge, in parallel with the app deploy, so for a
 * short window the code can be live before the columns are. Callers retry the
 * insert without the new columns in that case, so a lead is never lost to
 * deploy ordering.
 */
export function isMissingColumnError(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST204" || error?.code === "42703";
}
