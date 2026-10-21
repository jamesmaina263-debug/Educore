// Parsing and wording for admin_signup_visitors (20261020150000_admin_signup_visitors.sql), the "Who opened
// /signup" list on /admin/analytics. The database returns anonymous rows (no name, email, IP or visitor id);
// this validates the JSON so a changed or partial response can never throw, and words the labels.
// Pure and unit-tested. Nothing is estimated.

export type SignupVisitor = {
  day: string;
  firstSeenTime: string;
  signupTime: string;
  entryPath: string;
  source: string;
  campaign: string | null;
  country: string | null;
  device: string;
  pages: number;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}
function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Null only when the response is not an object at all; malformed rows are dropped. */
export function parseSignupVisitors(raw: unknown): SignupVisitor[] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rows = (raw as Record<string, unknown>).visitors;
  if (!Array.isArray(rows)) return [];
  const out: SignupVisitor[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const o = r as Record<string, unknown>;
    const day = str(o.day);
    if (!day) continue;
    out.push({
      day,
      firstSeenTime: str(o.first_seen_time) ?? "",
      signupTime: str(o.signup_time) ?? "",
      entryPath: str(o.entry_path) ?? "(unknown)",
      source: str(o.source) ?? "Direct",
      campaign: str(o.campaign),
      country: str(o.country),
      device: str(o.device) ?? "unknown",
      pages: num(o.pages),
    });
  }
  return out;
}

const DEVICE_LABELS: Record<string, string> = { mobile: "Phone", tablet: "Tablet", desktop: "Computer", unknown: "Unknown" };
export function deviceLabel(d: string): string {
  return DEVICE_LABELS[d] ?? "Unknown";
}

/** "KE" -> "Kenya". Falls back to the code, or a dash when there is none. */
export function countryLabel(code: string | null): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "—";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** True when the visitor landed straight on /signup (for example from a search result or an ad). */
export function landedOnSignup(v: SignupVisitor): boolean {
  return v.entryPath === "/signup" || v.entryPath.startsWith("/signup/");
}
