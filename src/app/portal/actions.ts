"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function portalLogout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/parent-login");
}

type ActionResult = { error: string } | { success: true };

export async function submitHomeworkAction(assignmentId: string, studentId: string, text: string): Promise<ActionResult> {
  if (!text.trim()) return { error: "Please write something before submitting." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("assignment_submissions")
    .upsert(
      { assignment_id: assignmentId, student_id: studentId, submission_text: text.trim(), status: "submitted" },
      { onConflict: "assignment_id,student_id" },
    );
  if (error) return { error: error.message };
  revalidatePath("/portal");
  return { success: true };
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

