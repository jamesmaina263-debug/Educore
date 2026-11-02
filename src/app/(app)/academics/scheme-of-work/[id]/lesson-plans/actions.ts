"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { validatePlan, type LessonPlanFields } from "@/lib/lesson-plans";

// Lesson plans are written under the caller's own session, so the table's row-level security (the same
// scheme_of_work permissions as the scheme entries, plus the feature flag) decides what is allowed.

export async function startLessonPlanAction(entryId: string): Promise<{ error: string } | { success: true; planId: string }> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("create_lesson_plan_from_entry", { p_entry_id: entryId });
  if (error) return { error: error.message };
  return { success: true, planId: data as string };
}

export async function saveLessonPlanAction(planId: string, schemeId: string, input: LessonPlanFields): Promise<{ error: string } | { success: true }> {
  const checked = validatePlan(input);
  if ("error" in checked) return { error: checked.error };
  const p = checked.value;
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase
    .from("lesson_plans")
    .update({
      objectives: p.objectives || null,
      introduction: p.introduction || null,
      development: p.development || null,
      conclusion: p.conclusion || null,
      assessment: p.assessment || null,
      resources: p.resources || null,
      homework: p.homework || null,
      reflection: p.reflection || null,
      duration_minutes: p.durationMinutes,
      status: p.status,
      taught_on: p.taughtOn,
    })
    .eq("id", planId)
    .select("id");
  if (error) return { error: error.message };
  // Row-level security hides rows you may not edit: zero rows back means "not allowed", not "saved".
  if (!data || data.length === 0) return { error: "You can't edit this lesson plan." };
  revalidatePath(`/academics/scheme-of-work/${schemeId}/lesson-plans`);
  return { success: true };
}
