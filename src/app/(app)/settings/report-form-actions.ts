"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { validateReportFormInput, type ReportFormLayout } from "@/lib/academics/report-form-layout";

// Saves the school's report wording through save_report_form_layout(), which re-checks exams.write, the
// feature flag and every length itself, and only ever writes the CALLER'S school. The checks here just
// give a friendly error before the round trip. Blank fields clear back to EduCore's default wording.
export async function saveReportFormLayout(input: ReportFormLayout): Promise<{ error: string } | { success: true }> {
  if (!input || typeof input !== "object") return { error: "Invalid report form." };
  const fields = ["title", "subtitle", "footerNote", "classTeacherLabel", "headTeacherLabel", "parentLabel"] as const;
  if (!fields.every((f) => input[f] === null || typeof input[f] === "string")) return { error: "Invalid report form." };
  const problem = validateReportFormInput(input);
  if (problem) return { error: problem };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const { error } = await supabase.rpc("save_report_form_layout", {
    p_title: input.title ?? "",
    p_subtitle: input.subtitle ?? "",
    p_footer_note: input.footerNote ?? "",
    p_class_teacher_label: input.classTeacherLabel ?? "",
    p_head_teacher_label: input.headTeacherLabel ?? "",
    p_parent_label: input.parentLabel ?? "",
  });
  if (error) {
    if (error.code === "42501") return { error: "You don't have permission to change the report form." };
    if (error.code === "55000") return { error: "Custom report forms are not enabled for this school." };
    if (error.code === "22023") return { error: "One of the fields is too long or has invalid characters." };
    return { error: "Could not save the report form. Please try again." };
  }

  revalidatePath("/settings/report-form");
  revalidatePath("/exams", "layout");
  revalidatePath("/portal");
  return { success: true };
}
