"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

export async function createReviewAction(input: {
  teacher_id: string;
  academic_year_id: string;
  term_id: string | null;
  review_type: "termly" | "annual";
  competency_scores: Record<string, number>;
  notes: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: reviewer } = await supabase.from("school_users").select("id, school_id").eq("auth_user_id", user?.id ?? "").maybeSingle();
  if (!reviewer) return { error: "Could not resolve your account." };

  const { error } = await supabase.from("teacher_performance_reviews").insert({
    school_id: reviewer.school_id,
    teacher_id: input.teacher_id,
    reviewer_id: reviewer.id,
    academic_year_id: input.academic_year_id,
    term_id: input.term_id,
    review_type: input.review_type,
    competency_scores: input.competency_scores,
    notes: input.notes,
  });
  if (error) return { error: error.message };
  revalidatePath("/performance");
  return { success: true };
}
