import type { ScoreKind } from "@/lib/academics/performance-analytics";

// Per-school analytics options saved by update_analytics_settings() (migration 20261106090000) in
// schools.analytics_settings. A missing key means "use the built-in default", so schools that never save
// anything are unchanged. Parsing is tolerant: anything that is not a valid number in range is ignored
// rather than trusted, so a bad value can never break the page.

export interface AnalyticsSettings {
  /** Percentage marks below this average need attention. */
  percentThreshold: number | null;
  /** CBC level points below this average need attention. */
  levelThreshold: number | null;
}

export const NO_SETTINGS: AnalyticsSettings = { percentThreshold: null, levelThreshold: null };

const inRange = (v: unknown, min: number, max: number, minInclusive: boolean): number | null => {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return (minInclusive ? v >= min : v > min) && v <= max ? v : null;
};

export function parseAnalyticsSettings(raw: unknown): AnalyticsSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NO_SETTINGS;
  const o = raw as Record<string, unknown>;
  return {
    percentThreshold: inRange(o.intervention_threshold_percent, 0, 100, false),
    levelThreshold: inRange(o.intervention_threshold_level, 1, 10, false),
  };
}

export type ThresholdSource = "url" | "saved" | "default";

/**
 * URL value wins (a one-off look), then the school's saved default, then the built-in default (undefined).
 * A URL value equal to the saved default is just the saved default; an out-of-range one is ignored.
 */
export function resolveThreshold(
  kind: ScoreKind,
  fromUrl: number | undefined,
  saved: AnalyticsSettings,
  isValid: (v: number) => boolean = () => true,
): { value: number | undefined; source: ThresholdSource } {
  const s = kind === "percent" ? saved.percentThreshold : saved.levelThreshold;
  if (fromUrl !== undefined && Number.isFinite(fromUrl) && isValid(fromUrl) && fromUrl !== s) return { value: fromUrl, source: "url" };
  if (s !== null && isValid(s)) return { value: s, source: "saved" };
  return { value: undefined, source: "default" };
}

export const SETTING_KEY: Record<ScoreKind, "intervention_threshold_percent" | "intervention_threshold_level"> = {
  percent: "intervention_threshold_percent",
  level: "intervention_threshold_level",
};

/** Same ranges the database enforces; checked first so the user gets a clear message instead of a raised error. */
export function validateThreshold(kind: ScoreKind, value: number): string | null {
  if (!Number.isFinite(value)) return "Enter a number.";
  if (kind === "percent") return value > 0 && value <= 100 ? null : "A percentage threshold must be above 0 and at most 100.";
  return value > 1 && value <= 10 ? null : "A level-points threshold must be above 1 and at most 10.";
}
