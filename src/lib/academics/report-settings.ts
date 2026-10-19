import type { createClient } from "@/lib/supabase/server";

// Per-school report options, stored as schools.report_settings (jsonb, written only through the
// update_report_settings() function). NULL / a missing key / a non-boolean value all resolve to the
// default, which is "on", i.e. exactly how reports behaved before this setting existed.

export interface ReportSettings {
  /** Show learner positions (the average is still shown). */
  rankingEnabled: boolean;
  /** Print the CBC competency ratings on report cards. */
  showCompetencyRatings: boolean;
  /** Print signature lines on mark sheets and report cards. */
  showSignatures: boolean;
  /** Print class mean / highest / lowest (or the CBC level summary) on the mark sheet. */
  showClassStatistics: boolean;
}

export const DEFAULT_REPORT_SETTINGS: ReportSettings = {
  rankingEnabled: true,
  showCompetencyRatings: true,
  showSignatures: true,
  showClassStatistics: true,
};

/** Stored key for each setting; must match the whitelist in update_report_settings(). */
export const REPORT_SETTING_KEYS: Record<keyof ReportSettings, string> = {
  rankingEnabled: "ranking_enabled",
  showCompetencyRatings: "show_competency_ratings",
  showSignatures: "show_signatures",
  showClassStatistics: "show_class_statistics",
};

export function resolveReportSettings(raw: unknown): ReportSettings {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_REPORT_SETTINGS };
  for (const field of Object.keys(REPORT_SETTING_KEYS) as (keyof ReportSettings)[]) {
    const v = obj[REPORT_SETTING_KEYS[field]];
    if (typeof v === "boolean") out[field] = v;
  }
  return out;
}

export function toStoredReportSettings(settings: ReportSettings): Record<string, boolean> {
  return Object.fromEntries((Object.keys(REPORT_SETTING_KEYS) as (keyof ReportSettings)[]).map((f) => [REPORT_SETTING_KEYS[f], settings[f]]));
}

type Client = Awaited<ReturnType<typeof createClient>>;

/** Reads the caller's own school row (RLS), so it can never return another school's settings. */
export async function loadReportSettings(supabase: Client, schoolId: string): Promise<ReportSettings> {
  const { data } = await supabase.from("schools").select("report_settings").eq("id", schoolId).maybeSingle();
  return resolveReportSettings(data?.report_settings);
}
