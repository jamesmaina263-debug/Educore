"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

export async function createAnnouncementAction(input: {
  title: string;
  body: string;
  urgency: "normal" | "action_required" | "urgent";
  scope: "whole_school" | "grade" | "class" | "student";
  targetClassId: string | null;
  targetStreamId: string | null;
  targetStudentId: string | null;
  publishNow: boolean;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_announcement", {
    p_title: input.title,
    p_body: input.body,
    p_scope: input.scope,
    p_urgency: input.urgency,
    p_target_class_id: input.targetClassId,
    p_target_stream_id: input.targetStreamId,
    p_target_student_id: input.targetStudentId,
  });
  if (error) return { error: error.message };

  if (input.publishNow) {
    const { error: publishError } = await supabase.rpc("publish_announcement", { p_id: data.id });
    if (publishError) return { error: publishError.message };
  }

  revalidatePath("/announcements");
  return { success: true };
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
