// Syllabus coverage maths for the Scheme of Work coverage dashboard (WP 7.4). Pure functions only:
// no Supabase, no Next.js, no clock -- every function takes "today" as a YYYY-MM-DD argument so the
// results are deterministic and testable. The page computes "today" in Africa/Nairobi.
//
// Definitions (kept deliberately simple and visible on the page):
//   * A lesson is DUE once its due date is strictly before today. Lessons planned for the current
//     week are not counted as late.
//   * Due date = the lesson's own entry_date when the teacher set one, otherwise the LAST day of its
//     planned week, counting calendar weeks from the term's start date (week 1 = the first 7 days).
//     Half-term breaks are not modelled, so a mid-term break makes the expectation slightly
//     optimistic for the weeks after it; the page says so.
//   * Coverage of the due lessons decides the status: >= 90% on track, 60-89% behind, < 60% critical.

export type CoverageStatus = "no_lessons" | "not_due" | "on_track" | "behind" | "critical";

export const ON_TRACK_MIN = 0.9;
export const BEHIND_MIN = 0.6;

export interface CoverageEntry {
  week_number: number;
  entry_date: string | null;
  completion_status: string;
}

export interface Coverage {
  /** All planned lessons. */
  total: number;
  /** Lessons ticked completed (due or not). */
  completed: number;
  /** Lessons whose due date has passed. */
  due: number;
  /** Due lessons that are completed. */
  dueCompleted: number;
  /** Due lessons NOT completed (how far behind). */
  lag: number;
  /** dueCompleted / due, or null when nothing is due yet. */
  dueRatio: number | null;
  status: CoverageStatus;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD plus n days (UTC arithmetic, so no daylight-saving or zone surprises). */
export function addDays(iso: string, n: number): string {
  if (!ISO_DATE.test(iso)) throw new Error(`Invalid date: ${iso}`);
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today's calendar date in Nairobi (EAT, UTC+3, no DST) as YYYY-MM-DD. */
export function nairobiToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The date a lesson is due by: its own entry_date, else the last day of its planned week. */
export function entryDueDate(entry: Pick<CoverageEntry, "week_number" | "entry_date">, termStart: string): string {
  if (entry.entry_date && ISO_DATE.test(entry.entry_date)) return entry.entry_date;
  const week = Math.max(1, Math.floor(entry.week_number));
  return addDays(termStart, week * 7 - 1);
}

export function isEntryDue(entry: Pick<CoverageEntry, "week_number" | "entry_date">, termStart: string, today: string): boolean {
  return entryDueDate(entry, termStart) < today;
}

export function classifyCoverage(total: number, due: number, dueCompleted: number): CoverageStatus {
  if (total === 0) return "no_lessons";
  if (due === 0) return "not_due";
  const ratio = dueCompleted / due;
  if (ratio >= ON_TRACK_MIN) return "on_track";
  if (ratio >= BEHIND_MIN) return "behind";
  return "critical";
}

function build(total: number, completed: number, due: number, dueCompleted: number): Coverage {
  return {
    total,
    completed,
    due,
    dueCompleted,
    lag: due - dueCompleted,
    dueRatio: due > 0 ? dueCompleted / due : null,
    status: classifyCoverage(total, due, dueCompleted),
  };
}

/** Coverage of one scheme's lessons against the term calendar. */
export function summariseScheme(entries: readonly CoverageEntry[], termStart: string, today: string): Coverage {
  let completed = 0;
  let due = 0;
  let dueCompleted = 0;
  for (const e of entries) {
    const isDone = e.completion_status === "completed";
    if (isDone) completed += 1;
    if (isEntryDue(e, termStart, today)) {
      due += 1;
      if (isDone) dueCompleted += 1;
    }
  }
  return build(entries.length, completed, due, dueCompleted);
}

/** Add several coverages together (e.g. all of one teacher's schemes) and re-classify the total. */
export function combineCoverage(parts: readonly Coverage[]): Coverage {
  let total = 0;
  let completed = 0;
  let due = 0;
  let dueCompleted = 0;
  for (const p of parts) {
    total += p.total;
    completed += p.completed;
    due += p.due;
    dueCompleted += p.dueCompleted;
  }
  return build(total, completed, due, dueCompleted);
}

const SEVERITY: Record<CoverageStatus, number> = { critical: 4, behind: 3, on_track: 2, not_due: 1, no_lessons: 0 };

/** Sort comparator: most urgent first (critical, then behind, ...), then by lessons outstanding. */
export function compareUrgency(a: Coverage, b: Coverage): number {
  const bySeverity = SEVERITY[b.status] - SEVERITY[a.status];
  if (bySeverity !== 0) return bySeverity;
  return b.lag - a.lag;
}

export interface CoverageGroup<K extends string = string> {
  key: K;
  label: string;
  schemes: number;
  coverage: Coverage;
}

/** Group scheme coverages by a key (teacher, subject, class...) and total each group, most urgent first. */
export function groupCoverage(
  rows: readonly { key: string; label: string; coverage: Coverage }[],
): CoverageGroup[] {
  const map = new Map<string, { label: string; parts: Coverage[] }>();
  for (const r of rows) {
    const g = map.get(r.key) ?? { label: r.label, parts: [] };
    g.parts.push(r.coverage);
    map.set(r.key, g);
  }
  return [...map.entries()]
    .map(([key, g]) => ({ key, label: g.label, schemes: g.parts.length, coverage: combineCoverage(g.parts) }))
    .sort((a, b) => compareUrgency(a.coverage, b.coverage) || a.label.localeCompare(b.label));
}

export interface TermDates {
  id: string;
  start_date: string;
  end_date: string;
}

/**
 * Which term the dashboard opens on: the term containing today; otherwise the most recent term that
 * has already started; otherwise the soonest upcoming term. Null when there are no terms.
 */
export function pickDefaultTerm<T extends TermDates>(terms: readonly T[], today: string): T | null {
  if (terms.length === 0) return null;
  const containing = terms.find((t) => t.start_date <= today && today <= t.end_date);
  if (containing) return containing;
  const started = terms.filter((t) => t.start_date <= today).sort((a, b) => b.start_date.localeCompare(a.start_date));
  if (started.length > 0) return started[0];
  return [...terms].sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
}

export const STATUS_LABEL: Record<CoverageStatus, string> = {
  no_lessons: "No lessons planned",
  not_due: "Not started",
  on_track: "On track",
  behind: "Behind",
  critical: "Far behind",
};
