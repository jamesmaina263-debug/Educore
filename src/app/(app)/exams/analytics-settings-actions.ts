"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SETTING_KEY, validateThreshold } from "@/lib/academics/analytics-settings";
import type { ScoreKind } from "@/lib/academics/performance-analytics";

const FILTER_KEYS = ["year", "class", "subject", "term", "band", "model"] as const;

/**
 * Saves (or clears) this school's "needs attention" threshold for one assessment model. The database
 * function update_analytics_settings() is the authority: it requires exams.write, only ever touches the
 * caller's own school, and re-checks the range. The range is also checked here so the user gets a plain
 * message instead of a raised error. Returns to the same filtered view.
 */
export async function saveAnalyticsThreshold(formData: FormData): Promise<void> {
  const kind: ScoreKind = formData.get("kind") === "level" ? "level" : "percent";
  const intent = formData.get("intent") === "reset" ? "reset" : "save";
  const keep = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = formData.get(`keep_${k}`);
    if (typeof v === "string" && v) keep.set(k, v);
  }
  const back = (extra: Record<string, string>) => {
    const q = new URLSearchParams(keep);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    redirect(`/exams/school-analytics?${q.toString()}`);
  };

  let value: number | null = null;
  if (intent === "save") {
    value = Number(formData.get("threshold"));
    const problem = validateThreshold(kind, value);
    if (problem) back({ settings_error: problem });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_analytics_settings", { p_settings: { [SETTING_KEY[kind]]: value } });
  if (error) back({ settings_error: error.message.includes("Not authorized") ? "Only users who can manage exams can change the school default." : "Could not save the threshold." });
  back({ settings: intent === "reset" ? "reset" : "saved" });
}
