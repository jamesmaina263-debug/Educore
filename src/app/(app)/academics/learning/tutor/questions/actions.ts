"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/bus-live";

type Result = { error: string } | { success: true };

// The school owner or principal records the three confirmations that switch learner questions on. The database
// re-checks the role, the flag and the contact (an active, non-parent staff member of this school).
export async function configureTutorQaAction(input: { contactId: string | null; dpiaConfirmed: boolean; parentNoticeConfirmed: boolean }): Promise<Result> {
  if (input.contactId !== null && !isUuid(input.contactId)) return { error: "Choose a safeguarding contact." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out. Sign in again." };
  const { error } = await supabase.rpc("tutor_qa_configure", { p_contact: input.contactId, p_dpia: input.dpiaConfirmed === true, p_notice: input.parentNoticeConfirmed === true });
  if (error) {
    if (error.code === "42501") return { error: "Only the school owner or principal can change this." };
    if (error.code === "55000") return { error: "Learner questions are not switched on for this school." };
    if (error.code === "22023") return { error: "The safeguarding contact must be an active member of staff." };
    return { error: "Could not save. Try again." };
  }
  revalidatePath("/academics/learning/tutor/questions");
  return { success: true };
}

// Marks a flagged (safeguarding) question as followed up. The database raises if nothing changed, so a click on a row that
// is already reviewed (or not yours to review) reports it instead of silently "succeeding".
export async function reviewTutorQuestionAction(id: string): Promise<Result> {
  if (!isUuid(id)) return { error: "Something went wrong." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out. Sign in again." };
  const { error } = await supabase.rpc("tutor_qa_review", { p_id: id });
  if (error) {
    if (error.code === "P0002") return { error: "That question was already marked as followed up." };
    if (error.code === "42501") return { error: "You can't mark this one." };
    return { error: "Could not save. Try again." };
  }
  revalidatePath("/academics/learning/tutor/questions");
  return { success: true };
}
