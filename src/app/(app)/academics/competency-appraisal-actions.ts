"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

async function schoolId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase.rpc("auth_school_id");
  if (error || !data) throw new Error("Could not resolve your school.");
  return data as string;
}

/**
 * Idempotent -- returns the school's existing competency-model grading
 * scale id, or provisions the default 3-2-1 one via the SECURITY DEFINER
 * RPC and returns that. Safe to call on every page load.
 */
export async function ensureDefaultCompetencyScale(): Promise<{ scaleId: string } | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ensure_default_competency_scale");
  if (error || !data) return { error: error?.message ?? "Could not set up the competency rating scale." };
  return { scaleId: data as string };
}

/**
 * Bulk upsert -- for fresh ratings, or edits within an open/upcoming term
 * (no edit_reason needed). Edits to a rating in a closed term must go
 * through editCompetencyIndicatorRating instead, with a reason -- the
 * DB trigger enforces this either way, this split just avoids prompting
 * for a reason on every save when it usually isn't needed.
 */
export async function submitCompetencyIndicatorRatings(input: {
  indicator_id: string;
  term_id: string;
  ratings: { student_id: string; band_id: string; observation: string | null }[];
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: schoolUser } = await supabase
      .from("school_users")
      .select("id")
      .eq("auth_user_id", user?.id ?? "")
      .maybeSingle();

    if (input.ratings.length === 0) return { success: true };

    const rows = input.ratings.map((r) => ({
      school_id,
      indicator_id: input.indicator_id,
      term_id: input.term_id,
      student_id: r.student_id,
      band_id: r.band_id,
      observation: r.observation?.trim() ? r.observation.trim() : null,
      teacher_id: schoolUser?.id ?? null,
    }));

    const { error } = await supabase
      .from("competency_indicator_ratings")
      .upsert(rows, { onConflict: "indicator_id,student_id,term_id" });
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save competency ratings." };
  }
  revalidatePath("/academics/competency-appraisal");
  return { success: true };
}

export async function editCompetencyIndicatorRating(input: {
  id: string;
  band_id: string;
  observation: string | null;
  edit_reason: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("competency_indicator_ratings")
    .update({
      band_id: input.band_id,
      observation: input.observation?.trim() ? input.observation.trim() : null,
      edit_reason: input.edit_reason,
    })
    .eq("id", input.id);
  if (error) return { error: error.message };
  revalidatePath("/academics/competency-appraisal");
  return { success: true };
}
