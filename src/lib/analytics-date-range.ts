import type { DateRangeInput } from "@/lib/plausible";

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

// Maps a UI period key to the date_range shape the Plausible Stats API
// expects, and separately to a [start, end] pair covering the *current*
// period -- used both for display and to derive the equivalent prior
// period for comparison. `custom` requires both `from`/`to` -- the caller
// (the admin page) is expected to have already fallen back to a preset if
// either is missing or invalid, so this function can assume they're present
// and well-formed by the time it's called with period === "custom".
export function resolveDateRange(
  period: PeriodKey,
  custom?: { from: string; to: string },
): { plausibleRange: DateRangeInput; startIso: string; endIso: string; label: string } {
  if (period === "today") {
    const today = isoDate(new Date());
    return { plausibleRange: "day", startIso: today, endIso: today, label: "Today" };
  }
  if (period === "yesterday") {
    const y = isoDate(daysAgo(1));
    return { plausibleRange: [y, y], startIso: y, endIso: y, label: "Yesterday" };
  }
  if (period === "7d") {
    return { plausibleRange: "7d", startIso: isoDate(daysAgo(6)), endIso: isoDate(new Date()), label: "Last 7 days" };
  }
  if (period === "30d") {
    return { plausibleRange: "30d", startIso: isoDate(daysAgo(29)), endIso: isoDate(new Date()), label: "Last 30 days" };
  }
  if (period === "custom" && custom) {
    const { from, to } = custom;
    return {
      plausibleRange: [from, to],
      startIso: from,
      endIso: to,
      label: from === to ? from : `${from} – ${to}`,
    };
  }
  // Plausible's built-in buckets stop at 91d; a custom [start, end] pair
  // gets an exact 90 days instead of relying on the closest preset.
  const start = isoDate(daysAgo(89));
  const end = isoDate(new Date());
  return { plausibleRange: [start, end], startIso: start, endIso: end, label: "Last 90 days" };
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
