// Pure logic backing the KNEC CBA assessment-window reminder panel (Phase 7). No cron/scheduled
// job -- this is a live view computed on each page load from:
//   - knec_cba_assessment_windows: platform-maintained (super_admin) reference data.
//   - knec_cba_window_dismissals: per-school "already handled" state.
// See 20260903071500_knec_cba_assessment_window_reminders.sql for the schema and RLS.

export interface KnecCbaAssessmentWindow {
  id: string;
  title: string;
  gradeLabels: string[] | null;
  opensAt: string | null;
  closesAt: string; // ISO date (YYYY-MM-DD)
  notes: string | null;
  sourceUrl: string | null;
}

export type KnecCbaWindowUrgency = "overdue" | "urgent" | "soon" | "upcoming";

export interface KnecCbaWindowReminder {
  window: KnecCbaAssessmentWindow;
  daysUntilClose: number; // negative once past closesAt
  urgency: KnecCbaWindowUrgency;
}

/**
 * Loose match between a school's own free-text class name (e.g. "Grade 9 North" -- there's no
 * canonical grade-number column, same situation as the pathway-guidance default-class heuristic)
 * and a window's grade_labels. Null/empty grade_labels means "applies to every grade".
 */
export function classNameMatchesGradeLabels(className: string, gradeLabels: string[] | null): boolean {
  if (!gradeLabels || gradeLabels.length === 0) return true;
  const normalized = className.toLowerCase();
  return gradeLabels.some((label) => normalized.includes(label.toLowerCase()));
}

/** How many whole days remain until (positive) or since (negative) closesAt, relative to `today`. */
export function daysUntil(closesAt: string, today: Date): number {
  const close = new Date(`${closesAt}T00:00:00`);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const closeDay = new Date(close.getFullYear(), close.getMonth(), close.getDate());
  return Math.round((closeDay.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

export function urgencyFor(daysUntilClose: number): KnecCbaWindowUrgency {
  if (daysUntilClose < 0) return "overdue";
  if (daysUntilClose <= 3) return "urgent";
  if (daysUntilClose <= 14) return "soon";
  return "upcoming";
}

/** Once a window has been closed this many days, stop showing it at all (even if never dismissed). */
const OVERDUE_GRACE_DAYS = 3;

/**
 * Builds the reminder list for one school: active windows relevant to at least one of its class
 * names, not dismissed, not closed more than a few days ago -- sorted soonest-closing first.
 */
export function buildKnecCbaWindowReminders(
  windows: KnecCbaAssessmentWindow[],
  schoolClassNames: string[],
  dismissedWindowIds: Set<string>,
  today: Date = new Date(),
): KnecCbaWindowReminder[] {
  return windows
    .filter((w) => !dismissedWindowIds.has(w.id))
    .filter((w) => schoolClassNames.some((cn) => classNameMatchesGradeLabels(cn, w.gradeLabels)))
    .map((w) => {
      const daysUntilClose = daysUntil(w.closesAt, today);
      return { window: w, daysUntilClose, urgency: urgencyFor(daysUntilClose) };
    })
    .filter((r) => r.daysUntilClose >= -OVERDUE_GRACE_DAYS)
    .sort((a, b) => a.daysUntilClose - b.daysUntilClose);
}
