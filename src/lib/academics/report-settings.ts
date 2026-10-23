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
  /** Print the term attendance summary on report cards (only when the register has records for the term). */
  showAttendance: boolean;
  /** Print the head teacher's comment on report cards (only when one has been written). */
  showHeadTeacherComment: boolean;
  /** Print the parent/guardian acknowledgement block on report cards. */
  showParentAcknowledgement: boolean;
}

export const DEFAULT_REPORT_SETTINGS: ReportSettings = {
  rankingEnabled: true,
  showCompetencyRatings: true,
  showSignatures: true,
  showClassStatistics: true,
  // New sections that would change how existing report cards look default to OFF, so merging them
  // changes nothing for a school until an administrator opts in. The head teacher comment defaults
  // on because nothing prints until a comment has actually been written.
  showAttendance: false,
  showHeadTeacherComment: true,
  showParentAcknowledgement: false,
};

/** Stored key for each setting; must match the whitelist in update_report_settings(). */
export const REPORT_SETTING_KEYS: Record<keyof ReportSettings, string> = {
  rankingEnabled: "ranking_enabled",
  showCompetencyRatings: "show_competency_ratings",
  showSignatures: "show_signatures",
  showClassStatistics: "show_class_statistics",
  showAttendance: "show_attendance",
  showHeadTeacherComment: "show_head_teacher_comment",
  showParentAcknowledgement: "show_parent_acknowledgement",
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
