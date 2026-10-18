// Shapes and display helpers for the admin "our own visit counter" panel. The data comes from the
// admin_page_view_summary() database function (see 20261017200000_first_party_page_views.sql).
// Safe to import from client components: no server-only code here.

export type PageViewRow = { label: string; value: number };
export type PageViewBucket = { bucket: string; views: number; visitors: number };

export type PageViewSummary = {
  from: string;
  to: string;
  views: number;
  /** Distinct visitors per day, summed over the days in the range. */
  visitors: number;
  /** Landing views that carried a Google or Meta ad click marker. */
  adVisits: number;
  /** The earliest day the counter has any data for, or null if it has recorded nothing yet. */
  firstRecordedDay: string | null;
  series: PageViewBucket[];
  topPages: PageViewRow[];
  sources: PageViewRow[];
  countries: PageViewRow[];
  devices: PageViewRow[];
};

function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function toRows(value: unknown): PageViewRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((r): r is { label: unknown; value: unknown } => !!r && typeof r === "object")
    .map((r) => ({ label: String(r.label ?? ""), value: toCount(r.value) }))
    .filter((r) => r.label !== "");
}

function toBuckets(value: unknown): PageViewBucket[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((r): r is { bucket: unknown; views: unknown; visitors: unknown } => !!r && typeof r === "object")
    .map((r) => ({ bucket: String(r.bucket ?? ""), views: toCount(r.views), visitors: toCount(r.visitors) }));
}

/** Validates the jsonb the database function returns. Null means "not usable". */
export function parsePageViewSummary(data: unknown): PageViewSummary | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.from !== "string" || typeof d.to !== "string") return null;
  return {
    from: d.from,
    to: d.to,
    views: toCount(d.views),
    visitors: toCount(d.visitors),
    adVisits: toCount(d.adVisits),
    firstRecordedDay: typeof d.firstRecordedDay === "string" ? d.firstRecordedDay : null,
    series: toBuckets(d.series),
    topPages: toRows(d.topPages),
    sources: toRows(d.sources),
    countries: toRows(d.countries),
    devices: toRows(d.devices),
  };
}

/** "KE" -> "Kenya". Falls back to the code itself, and "??" (no geo header) to "Unknown". */
export function countryLabel(code: string): string {
  if (code === "??") return "Unknown";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function deviceLabel(device: string): string {
  switch (device) {
    case "mobile":
      return "Phone";
    case "tablet":
      return "Tablet";
    case "desktop":
      return "Computer";
    default:
      return "Unknown";
  }
}
