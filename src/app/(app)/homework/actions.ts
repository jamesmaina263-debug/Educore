"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { safeStorageFilename } from "@/lib/storage-path";

type ActionResult = { error: string } | { success: true };

async function currentSchoolUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, schoolUser: null };
  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("id, school_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return { supabase, schoolUser };
}

export async function createAssignmentAction(input: {
  stream_id: string;
  subject_id: string;
  title: string;
  description: string;
  due_date: string;
}): Promise<{ error: string } | { success: true; id: string }> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const title = input.title.trim();
  const description = input.description.trim();
  if (!input.stream_id || !input.subject_id || !title || !input.due_date) {
    return { error: "Class, subject, title, and due date are all required." };
  }

  const { data, error } = await supabase
    .from("assignments")
    .insert({
      school_id: schoolUser.school_id,
      stream_id: input.stream_id,
      subject_id: input.subject_id,
      teacher_id: schoolUser.id,
      title,
      description: description || null,
      due_date: input.due_date,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/homework");
  return { success: true, id: data.id };
}

/**
 * Task file the teacher attaches to the assignment (worksheet, instructions,
 * etc). Same upload-then-record shape as
 * uploadAnnouncementAttachmentAction -- filename sanitised server-side
 * before it becomes a storage key, and the row is only recorded after a
 * successful upload.
 */
export async function uploadAssignmentAttachmentAction(assignmentId: string, formData: FormData): Promise<ActionResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file provided." };

  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const path = `${schoolUser.school_id}/${assignmentId}/task/${Date.now()}-${safeStorageFilename(file.name)}`;

  const { error: uploadError } = await supabase.storage.from("assignment-attachments").upload(path, file);
  if (uploadError) return { error: uploadError.message };

  const { error: insertError } = await supabase.from("assignment_attachments").insert({
    assignment_id: assignmentId,
    storage_path: path,
    file_name: file.name,
    file_size: file.size,
    content_type: file.type || null,
    uploaded_by: schoolUser.id,
  });
  if (insertError) {
    await supabase.storage.from("assignment-attachments").remove([path]);
    return { error: insertError.message };
  }

  revalidatePath("/homework");
  return { success: true };
}

export async function deleteAssignmentAttachmentAction(attachmentId: string): Promise<ActionResult> {
  const { supabase } = await currentSchoolUser();
  const { data: row, error: fetchError } = await supabase
    .from("assignment_attachments")
    .select("storage_path")
    .eq("id", attachmentId)
    .maybeSingle();
  if (fetchError) return { error: fetchError.message };
  if (!row) return { error: "Attachment not found." };

  const { error } = await supabase.from("assignment_attachments").delete().eq("id", attachmentId);
  if (error) return { error: error.message };

  await supabase.storage.from("assignment-attachments").remove([row.storage_path]);
  revalidatePath("/homework");
  return { success: true };
}

/**
 * Signed download link for anything in the shared assignment-attachments
 * bucket -- works for both task files and a student's submission files,
 * since bucket-level RLS already gates each path independently.
 */
export async function getAssignmentAttachmentUrlAction(storagePath: string): Promise<{ url: string } | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("assignment-attachments").createSignedUrl(storagePath, 60 * 5);
  if (error || !data) return { error: error?.message ?? "Could not create download link." };
  return { url: data.signedUrl };
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
    .select(
      "id, submission_text, status, grade, feedback, submitted_at, students(first_name, last_name, admission_number), assignment_submission_attachments(id, file_name, storage_path, file_size)",
    )
    .eq("assignment_id", assignmentId)
    .order("submitted_at", { ascending: false });
  if (error) return { error: error.message };
  return {
    success: true as const,
    rows: (data ?? []).map((s) => {
      const student = s.students as unknown as { first_name: string; last_name: string; admission_number: string } | null;
      const attachments = (s.assignment_submission_attachments ?? []) as { id: string; file_name: string; storage_path: string; file_size: number | null }[];
      return {
        id: s.id,
        submission_text: s.submission_text,
        status: s.status as "submitted" | "graded",
        grade: s.grade,
        feedback: s.feedback,
        submitted_at: s.submitted_at,
        student_name: student ? `${student.first_name} ${student.last_name}` : "Unknown",
        admission_number: student?.admission_number ?? "—",
        attachments,
      };
    }),
  };
}
