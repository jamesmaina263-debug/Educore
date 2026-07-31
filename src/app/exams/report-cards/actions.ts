"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

export async function generateReportCards(examId: string, classId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("generate_report_cards", { p_exam_id: examId, p_class_id: classId });
  if (error) return { error: error.message };
  revalidatePath("/exams/report-cards");
  return { success: true };
}

export async function approveComment(input: { exam_id: string; student_id: string }): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("id")
    .eq("auth_user_id", user?.id ?? "")
    .maybeSingle();

  const { error } = await supabase
    .from("report_cards")
    .update({ comment_source: "teacher_approved", approved_by: schoolUser?.id ?? null, approved_at: new Date().toISOString() })
    .eq("exam_id", input.exam_id)
    .eq("student_id", input.student_id);
  if (error) return { error: error.message };
  revalidatePath("/exams/report-cards");
  return { success: true };
}

export async function writeComment(input: { exam_id: string; student_id: string; comment: string }): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("id")
    .eq("auth_user_id", user?.id ?? "")
    .maybeSingle();

  const { error } = await supabase
    .from("report_cards")
    .update({
      comment: input.comment,
      comment_source: "teacher_written",
      approved_by: schoolUser?.id ?? null,
      approved_at: new Date().toISOString(),
    })
    .eq("exam_id", input.exam_id)
    .eq("student_id", input.student_id);
  if (error) return { error: error.message };
  revalidatePath("/exams/report-cards");
  return { success: true };
}
