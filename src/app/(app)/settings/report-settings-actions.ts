"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { REPORT_SETTING_KEYS, toStoredReportSettings, type ReportSettings } from "@/lib/academics/report-settings";

// Saves the school's report options through update_report_settings(), which re-checks the
// exams.write permission, validates every key/type itself and only ever writes the CALLER'S school
// (auth_school_id()). The checks here just give a friendly error before the round trip.
export async function updateReportSettings(input: ReportSettings): Promise<{ error: string } | { success: true }> {
  const fields = Object.keys(REPORT_SETTING_KEYS) as (keyof ReportSettings)[];
  if (!input || typeof input !== "object" || !fields.every((f) => typeof input[f] === "boolean")) {
    return { error: "Invalid report settings." };
  }

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const { error } = await supabase.rpc("update_report_settings", { p_settings: toStoredReportSettings(input) });
  if (error) {
    return { error: /not authorized/i.test(error.message) ? "You don't have permission to change report settings." : "Could not save report settings. Please try again." };
  }

  revalidatePath("/settings/reports");
  revalidatePath("/exams", "layout");
  revalidatePath("/portal");
  return { success: true };
}
