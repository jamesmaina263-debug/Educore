export type PeriodKey = "today" | "yesterday" | "7d" | "30d" | "90d" | "custom";

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: string | undefined): value is string {
  if (!value || !ISO_DATE_RE.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// The GA4 property's reporting time zone (GA4 Admin > Property settings: "Kenya Time", UTC+3, no
// DST). GA4 buckets every day in this zone, so the analytics page must work out "today" and day
// boundaries in it too -- in UTC, "Today" asks GA4 for yesterday between 00:00 and 03:00 Nairobi.
export const ANALYTICS_TIME_ZONE = "Africa/Nairobi";
/** Fixed UTC offset of ANALYTICS_TIME_ZONE (Kenya has no daylight saving). */
export const ANALYTICS_UTC_OFFSET = "+03:00";

type RangeOptions = {
  /** IANA zone used to decide which calendar day it is. Defaults to UTC, which the finance
   *  overview page relies on; only the GA4 analytics page opts in to ANALYTICS_TIME_ZONE. */
  timeZone?: string;
  /** Clock override, for tests. */
  now?: Date;
};

/** "YYYY-MM-DD" for `now` as seen in `timeZone`. */
export function todayIso(timeZone = "UTC", now: Date = new Date()): string {
  // The en-CA locale formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function daysAgoIso(n: number, timeZone: string, now: Date): string {
  const [y, m, d] = todayIso(timeZone, now).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - n);
  return isoDate(date);
}

/** Start of a calendar day (in ANALYTICS_TIME_ZONE) as a UTC ISO timestamp, for database filters. */
export function dayStartUtc(iso: string): string {
  return new Date(`${iso}T00:00:00.000${ANALYTICS_UTC_OFFSET}`).toISOString();
}

/** End of a calendar day (in ANALYTICS_TIME_ZONE) as a UTC ISO timestamp, for database filters. */
export function dayEndUtc(iso: string): string {
  return new Date(`${iso}T23:59:59.999${ANALYTICS_UTC_OFFSET}`).toISOString();
}

// Maps a UI period key to a [start, end] ISO date pair covering the
// *current* period -- used both for display and to derive the equivalent
// prior period for comparison (see priorPeriod below), and passed straight
// into GA4's GaDateRangeInput ([startDate, endDate]) by the caller. `custom`
// requires both `from`/`to` -- the caller (the admin page) is expected to
// have already fallen back to a preset if either is missing or invalid, so
// this function can assume they're present and well-formed by the time
// it's called with period === "custom".
export function resolveDateRange(
  period: PeriodKey,
  custom?: { from: string; to: string },
  options: RangeOptions = {},
): { startIso: string; endIso: string; label: string } {
  const { timeZone = "UTC", now = new Date() } = options;
  const today = todayIso(timeZone, now);
  if (period === "today") {
    return { startIso: today, endIso: today, label: "Today" };
  }
  if (period === "yesterday") {
    const y = daysAgoIso(1, timeZone, now);
    return { startIso: y, endIso: y, label: "Yesterday" };
  }
  if (period === "7d") {
    return { startIso: daysAgoIso(6, timeZone, now), endIso: today, label: "Last 7 days" };
  }
  if (period === "30d") {
    return { startIso: daysAgoIso(29, timeZone, now), endIso: today, label: "Last 30 days" };
  }
  if (period === "custom" && custom) {
    const { from, to } = custom;
    return {
      startIso: from,
      endIso: to,
      label: from === to ? from : `${from} – ${to}`,
    };
  }
  return { startIso: daysAgoIso(89, timeZone, now), endIso: today, label: "Last 90 days" };
}

// Equivalent-length prior period for a given [start, end] pair, so KPI
// cards can show a real percent change rather than a made-up trend arrow.
export function priorPeriod(startIso: string, endIso: string): { startIso: string; endIso: string } {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const priorEnd = new Date(start);
  priorEnd.setUTCDate(priorEnd.getUTCDate() - 1);
  const priorStart = new Date(priorEnd);
  priorStart.setUTCDate(priorStart.getUTCDate() - (days - 1));
  return { startIso: isoDate(priorStart), endIso: isoDate(priorEnd) };
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null; // undefined % change from a true zero baseline
  return ((current - previous) / previous) * 100;
}

// A daily trend line over 90 days is 90 points -- technically correct but
// unreadable, and the spec explicitly asks for "visitors by day/week/month".
// This picks a reasonable default per period; the page still lets the user
// override it via the granularity toggle.
export function defaultGranularity(period: PeriodKey, startIso: string, endIso: string): "day" | "week" | "month" {
  if (period === "today" || period === "yesterday" || period === "7d") return "day";
  const days = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 86_400_000) + 1;
  if (days > 60) return "month";
  if (days > 21) return "week";
  return "day";
}
