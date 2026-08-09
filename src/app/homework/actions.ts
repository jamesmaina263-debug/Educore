"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

export async function createAssignmentAction(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: schoolUser } = await supabase.from("school_users").select("id, school_id").eq("auth_user_id", user.id).maybeSingle();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const streamId = String(formData.get("stream_id") ?? "");
  const subjectId = String(formData.get("subject_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const dueDate = String(formData.get("due_date") ?? "");

  if (!streamId || !subjectId || !title || !dueDate) {
    return { error: "Class, subject, title, and due date are all required." };
  }

  const { error } = await supabase.from("assignments").insert({
    school_id: schoolUser.school_id,
    stream_id: streamId,
    subject_id: subjectId,
    teacher_id: schoolUser.id,
    title,
    description: description || null,
    due_date: dueDate,
  });
  if (error) return { error: error.message };

  revalidatePath("/homework");
  return { success: true };
}

export async function gradeSubmissionAction(
  submissionId: string,
  grade: string,
  feedback: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("assignment_submissions")
    .update({ status: "graded", grade: grade.trim() || null, feedback: feedback.trim() || null })
    .eq("id", submissionId);
  if (error) return { error: error.message };

  revalidatePath("/homework");
  return { success: true };
}

export async function getSubmissionsAction(assignmentId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assignment_submissions")
    .select("id, submission_text, status, grade, feedback, submitted_at, students(first_name, last_name, admission_number)")
    .eq("assignment_id", assignmentId)
    .order("submitted_at", { ascending: false });
  if (error) return { error: error.message };
  return {
    success: true as const,
    rows: (data ?? []).map((s) => {
      const student = s.students as unknown as { first_name: string; last_name: string; admission_number: string } | null;
      return {
        id: s.id,
        submission_text: s.submission_text,
        status: s.status as "submitted" | "graded",
        grade: s.grade,
        feedback: s.feedback,
        submitted_at: s.submitted_at,
        student_name: student ? `${student.first_name} ${student.last_name}` : "Unknown",
        admission_number: student?.admission_number ?? "—",
      };
    }),
  };
}
