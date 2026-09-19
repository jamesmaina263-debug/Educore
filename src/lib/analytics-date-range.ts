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

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
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
): { startIso: string; endIso: string; label: string } {
  if (period === "today") {
    const today = isoDate(new Date());
    return { startIso: today, endIso: today, label: "Today" };
  }
  if (period === "yesterday") {
    const y = isoDate(daysAgo(1));
    return { startIso: y, endIso: y, label: "Yesterday" };
  }
  if (period === "7d") {
    return { startIso: isoDate(daysAgo(6)), endIso: isoDate(new Date()), label: "Last 7 days" };
  }
  if (period === "30d") {
    return { startIso: isoDate(daysAgo(29)), endIso: isoDate(new Date()), label: "Last 30 days" };
  }
  if (period === "custom" && custom) {
    const { from, to } = custom;
    return {
      startIso: from,
      endIso: to,
      label: from === to ? from : `${from} – ${to}`,
    };
  }
  const start = isoDate(daysAgo(89));
  const end = isoDate(new Date());
  return { startIso: start, endIso: end, label: "Last 90 days" };
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
