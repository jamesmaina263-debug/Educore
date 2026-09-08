// Growth analysis (Performance Appraisal Engine directive, Phase 12 /
// roadmap Step 8). Turns an already-fetched, already-chronologically-sorted
// series of numeric values (a subject's percentage per term, or a
// competency/value/PCI rating's points per term) into a classified trend.
//
// Deliberately pure and side-effect-free, same convention as pathway-fit.ts
// -- all the Supabase fetching/joining lives in the calling server action,
// this file only classifies numbers it's handed. That's what makes it
// unit-testable (see growth-trend.test.ts) rather than something that can
// only be checked by clicking through the UI.
//
// Directive requirement: "Do not generate misleading trends when there is
// insufficient historical data." -- enforced by requiring at least 2 points
// before ever returning improving/declining/stable; 0 or 1 points always
// returns insufficient_data, never a guess.

export type TrendDirection = "improving" | "declining" | "stable" | "insufficient_data";

export interface TrendPoint {
  /** Display label for this point (e.g. a term or exam name). Not used for ordering -- points must already be chronologically sorted by the caller. */
  label: string;
  value: number;
}

export interface TrendResult {
  direction: TrendDirection;
  /** Most-recent-minus-earliest value in the series. Null when there's fewer than 2 points to compare. */
  change: number | null;
  points: TrendPoint[];
}

/** Absolute change below this (in the same units as `value`, e.g. percentage points or scale points) reads as "stable" rather than improving/declining. */
export const DEFAULT_STABLE_THRESHOLD = 5;

/**
 * Classifies a chronologically-sorted series by comparing its first and last
 * points. Deliberately simple (not a regression/slope fit) so a school can
 * always explain why a trend was called what it was called -- matches the
 * directive's "every calculation should be deterministic and testable"
 * principle from the achievement-scale section, applied here too.
 */
export function classifyTrend(points: TrendPoint[], stableThreshold: number = DEFAULT_STABLE_THRESHOLD): TrendResult {
  if (points.length < 2) {
    return { direction: "insufficient_data", change: null, points };
  }
  const change = points[points.length - 1].value - points[0].value;
  let direction: TrendDirection;
  if (change > stableThreshold) direction = "improving";
  else if (change < -stableThreshold) direction = "declining";
  else direction = "stable";
  return { direction, change, points };
}
