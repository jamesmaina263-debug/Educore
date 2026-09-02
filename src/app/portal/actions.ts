"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { safeStorageFilename } from "@/lib/storage-path";

export async function portalLogout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/parent-login");
}

type ActionResult = { error: string } | { success: true };

export async function submitHomeworkAction(
  assignmentId: string,
  studentId: string,
  text: string,
  hasFiles: boolean,
): Promise<{ error: string } | { success: true; submissionId: string }> {
  if (!text.trim() && !hasFiles) return { error: "Write something or attach a file before submitting." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assignment_submissions")
    .upsert(
      { assignment_id: assignmentId, student_id: studentId, submission_text: text.trim(), status: "submitted" },
      { onConflict: "assignment_id,student_id" },
    )
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/portal");
  return { success: true, submissionId: data.id };
}

/**
 * Completed-work file the student/guardian attaches to their own
 * submission. Mirrors uploadAnnouncementAttachmentAction's shape; RLS on
 * both the table and the storage bucket already restrict this to the
 * submission's own guardian/student while it's still 'submitted' (pre-grade).
 */
export async function uploadSubmissionAttachmentAction(
  submissionId: string,
  assignmentId: string,
  formData: FormData,
): Promise<{ error: string } | { success: true }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file provided." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: schoolUser } = await supabase.from("school_users").select("id, school_id").eq("auth_user_id", user.id).maybeSingle();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const path = `${schoolUser.school_id}/${assignmentId}/submission/${submissionId}/${Date.now()}-${safeStorageFilename(file.name)}`;

  const { error: uploadError } = await supabase.storage.from("assignment-attachments").upload(path, file);
  if (uploadError) return { error: uploadError.message };

  const { error: insertError } = await supabase.from("assignment_submission_attachments").insert({
    submission_id: submissionId,
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

  revalidatePath("/portal");
  return { success: true };
}

export async function deleteSubmissionAttachmentAction(attachmentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: row, error: fetchError } = await supabase
    .from("assignment_submission_attachments")
    .select("storage_path")
    .eq("id", attachmentId)
    .maybeSingle();
  if (fetchError) return { error: fetchError.message };
  if (!row) return { error: "Attachment not found." };

  const { error } = await supabase.from("assignment_submission_attachments").delete().eq("id", attachmentId);
  if (error) return { error: error.message };

  await supabase.storage.from("assignment-attachments").remove([row.storage_path]);
  revalidatePath("/portal");
  return { success: true };
}

/**
 * Signed download link for the shared assignment-attachments bucket --
 * duplicated from homework/actions.ts's copy, same convention already used
 * for getAnnouncementAttachmentUrlAction existing separately in both
 * announcements/actions.ts and here.
 */
export async function getAssignmentAttachmentUrlAction(storagePath: string): Promise<{ url: string } | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("assignment-attachments").createSignedUrl(storagePath, 60 * 5);
  if (error || !data) return { error: error?.message ?? "Could not create download link." };
  return { url: data.signedUrl };
}

export async function bookPtSlotAction(slotId: string, studentId: string, notes: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: schoolUser } = await supabase.from("school_users").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const { error } = await supabase.from("pt_meeting_bookings").insert({
    slot_id: slotId,
    student_id: studentId,
    guardian_user_id: schoolUser.id,
    notes: notes.trim() || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/portal");
  return { success: true };
}

export async function cancelPtBookingAction(bookingId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("pt_meeting_bookings").update({ status: "cancelled" }).eq("id", bookingId);
  if (error) return { error: error.message };
  revalidatePath("/portal");
  return { success: true };
}

export async function markConnectItemReadAction(itemId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_connect_item_read", { p_item_id: itemId });
  if (error) return { error: error.message };
  revalidatePath("/portal");
  return { success: true };
}

export async function acknowledgeConnectItemAction(itemId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_connect_item", { p_item_id: itemId });
  if (error) return { error: error.message };
  revalidatePath("/portal");
  return { success: true };
}

export async function replyConnectItemAction(itemId: string, body: string): Promise<ActionResult> {
  if (!body.trim()) return { error: "Please write a reply before sending." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reply_connect_item", { p_item_id: itemId, p_body: body.trim() });
  if (error) return { error: error.message };
  revalidatePath("/portal");
  return { success: true };
}

export async function markAnnouncementReadAction(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_announcement_read", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/portal");
  return { success: true };
}

export async function acknowledgeAnnouncementAction(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_announcement", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/portal");
  return { success: true };
}

export async function completeAnnouncementAction(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_announcement_action", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/portal");
  return { success: true };
}

export async function getAnnouncementAttachmentUrlAction(storagePath: string): Promise<{ url: string } | { error: string }> {
  const supabase = await createClient();
  // Bucket RLS (announcement_attachments_storage_select) already restricts this to
  // announcements the caller is an actual recipient of -- no extra check needed here.
  const { data, error } = await supabase.storage.from("announcement-attachments").createSignedUrl(storagePath, 60 * 5);
  if (error || !data) return { error: error?.message ?? "could not create download link" };
  return { url: data.signedUrl };
}

