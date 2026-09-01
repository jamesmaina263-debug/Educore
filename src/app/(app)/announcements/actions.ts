"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { safeStorageFilename } from "@/lib/storage-path";

type ActionResult = { error: string } | { success: true };

export async function createAnnouncementAction(input: {
  title: string;
  body: string;
  urgency: "normal" | "action_required" | "urgent";
  scope: "whole_school" | "grade" | "class" | "student" | "boarding_house";
  targetClassId: string | null;
  targetStreamId: string | null;
  targetStudentId: string | null;
  targetHouseId: string | null;
  publishNow: boolean;
  /** PA-07: ISO timestamp to auto-publish at. Ignored if publishNow is true. */
  scheduledAt?: string | null;
}): Promise<ActionResult & { id?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_announcement", {
    p_title: input.title,
    p_body: input.body,
    p_scope: input.scope,
    p_urgency: input.urgency,
    p_target_class_id: input.targetClassId,
    p_target_stream_id: input.targetStreamId,
    p_target_student_id: input.targetStudentId,
    p_target_house_id: input.targetHouseId,
    p_scheduled_at: input.publishNow ? null : (input.scheduledAt ?? null),
  });
  if (error) return { error: error.message };

  if (input.publishNow) {
    const { error: publishError } = await supabase.rpc("publish_announcement", { p_id: data.id });
    if (publishError) return { error: publishError.message };
  }

  revalidatePath("/announcements");
  return { success: true, id: data.id };
}

export async function publishAnnouncementAction(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_announcement", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/announcements");
  return { success: true };
}

export async function withdrawAnnouncementAction(id: string, reason: string | null): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_announcement", { p_id: id, p_reason: reason });
  if (error) return { error: error.message };
  revalidatePath("/announcements");
  return { success: true };
}

export async function acknowledgeAnnouncementAction(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_announcement", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/announcements");
  return { success: true };
}

/**
 * PA-08. Uploads to the announcement-attachments bucket, then records the row
 * via record_announcement_attachment(). Kept as one server action (not a
 * client-side direct-to-storage upload) so the filename is sanitised
 * server-side before it becomes a storage key -- same precaution already
 * applied to the public admissions upload paths in this codebase -- and so
 * the RPC's ownership check runs before anything is left in storage
 * unreferenced.
 */
export async function uploadAnnouncementAttachmentAction(
  announcementId: string,
  formData: FormData,
): Promise<ActionResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "no file provided" };

  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { error: "no active session" };

  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("id, school_id")
    .eq("auth_user_id", userRes.user.id)
    .maybeSingle();
  if (!schoolUser) return { error: "no active school session" };

  const path = `${schoolUser.school_id}/${announcementId}/${Date.now()}-${safeStorageFilename(file.name)}`;

  const { error: uploadError } = await supabase.storage.from("announcement-attachments").upload(path, file);
  if (uploadError) return { error: uploadError.message };

  const { error: recordError } = await supabase.rpc("record_announcement_attachment", {
    p_announcement_id: announcementId,
    p_storage_path: path,
    p_file_name: file.name,
    p_file_size: file.size,
    p_content_type: file.type || null,
  });
  if (recordError) {
    // best-effort cleanup so a rejected record doesn't leave an orphaned object
    await supabase.storage.from("announcement-attachments").remove([path]);
    return { error: recordError.message };
  }

  revalidatePath("/announcements");
  return { success: true };
}

export async function deleteAnnouncementAttachmentAction(attachmentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("delete_announcement_attachment", {
    p_attachment_id: attachmentId,
  });
  if (error) return { error: error.message };
  if (path) await supabase.storage.from("announcement-attachments").remove([path]);
  revalidatePath("/announcements");
  return { success: true };
}

export async function getAnnouncementAttachmentUrlAction(storagePath: string): Promise<{ url: string } | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("announcement-attachments")
    .createSignedUrl(storagePath, 60 * 5); // 5-minute expiry -- short-lived, regenerated on each click
  if (error || !data) return { error: error?.message ?? "could not create download link" };
  return { url: data.signedUrl };
}
