"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { extractEdgeFunctionError } from "@/lib/edge-function-error";

type ActionResult = { error: string } | { success: true };

async function schoolId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase.rpc("auth_school_id");
  if (error || !data) throw new Error("Could not resolve your school.");
  return data as string;
}

export async function createTemplateAction(input: {
  name: string;
  category: "fee_reminder" | "absence_alert" | "result_published" | "announcement" | "other";
  body: string;
  channel: "sms" | "email" | "whatsapp" | "in_app";
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const { error } = await supabase.from("communication_templates").insert({ school_id, ...input });
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create the template." };
  }
  revalidatePath("/communication");
  return { success: true };
}

export async function updateTemplateAction(
  id: string,
  input: {
    name: string;
    category: "fee_reminder" | "absence_alert" | "result_published" | "announcement" | "other";
    body: string;
    channel: "sms" | "email" | "whatsapp" | "in_app";
  },
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("communication_templates").update(input).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/communication");
  return { success: true };
}

export type Recipient = {
  phone?: string;
  email?: string;
  student_id: string | null;
  recipient_type: "guardian" | "student" | "staff";
  // Lets queue_communication check the recipient's own notification_preferences before queueing —
  // omitted entirely (rather than sent null) falls back to "always send", same as before this
  // feature existed, so an older caller of this action never regresses.
  school_user_id?: string;
  values: Record<string, string>;
};

// Queues the message (RLS-gated insert via queue_communication), then invokes the Edge Function to
// actually dispatch it through the configured channel provider (SMS/Email/WhatsApp). Queueing and
// dispatch are deliberately two steps — if the Edge Function call fails partway (e.g. the provider
// is unreachable), the rows are still safely queued and can be retried via "Send pending" rather
// than lost.
export async function composeAndSendAction(input: {
  recipients: Recipient[];
  template_id?: string;
  body?: string;
  channel: "sms" | "email" | "whatsapp" | "in_app";
  subject?: string;
}): Promise<{ error: string } | { success: true; sent: number; failed: number; total: number }> {
  const supabase = await createClient();

  const { data: queuedCount, error: queueError } = await supabase.rpc("queue_communication", {
    p_recipients: input.recipients,
    p_template_id: input.template_id ?? null,
    p_body: input.body ?? null,
    p_channel: input.channel,
    p_subject: input.subject ?? null,
  });
  if (queueError) return { error: queueError.message };
  if (!queuedCount) return { error: "No recipients to send to." };

  // In-app messages deliver immediately at insert time (queue_communication marks them
  // 'delivered', not 'queued') — there's no external provider step, so there's nothing
  // for the dispatch Edge Function to do. Skip it entirely for that channel.
  if (input.channel === "in_app") {
    revalidatePath("/communication");
    return { success: true, sent: queuedCount, failed: 0, total: queuedCount };
  }

  return dispatchPending();
}

// Sweeps any status='queued' rows for the caller's school — covers both a manual send that got
// queued but not yet dispatched, and system-queued rows (the automatic absence-alert trigger).
export async function dispatchPending(): Promise<{ error: string } | { success: true; sent: number; failed: number; total: number }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "Not signed in." };

  const { data, error } = await supabase.functions.invoke("send-communication", {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) return { error: await extractEdgeFunctionError(error, "Failed to send.") };
  revalidatePath("/communication");
  return { success: true, sent: data.sent, failed: data.failed, total: data.total };
}

// -------------------- WhatsApp inbox --------------------

export type WhatsAppMessageRow = {
  id: string;
  direction: "inbound" | "outbound";
  sender_type: "guardian" | "bot" | "staff";
  body: string;
  status: "received" | "sent" | "delivered" | "failed";
  created_at: string;
};

// Lazy-loaded per conversation when the staff member selects a thread in the inbox, rather than
// shipping every message for every conversation on initial page load.
export async function fetchWhatsAppMessages(conversationId: string): Promise<WhatsAppMessageRow[] | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("id, direction, sender_type, body, status, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) return { error: error.message };
  return (data ?? []) as WhatsAppMessageRow[];
}

// Sends the staff member's reply: invokes the Edge Function (it has to -- Postgres can't call the
// Twilio API directly), which both dispatches the WhatsApp message and logs it. Marks the thread
// staff_handling and clears unread_count as a side effect of that function, not here.
export async function sendWhatsAppReplyAction(conversationId: string, message: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "Not signed in." };

  const { data, error } = await supabase.functions.invoke("whatsapp-send-reply", {
    body: { conversation_id: conversationId, message },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/communication");
  return { success: true };
}

// Claims an unassigned/escalated thread -- assigns to self and marks staff_handling, without
// requiring the staff member to type a reply first just to take ownership of the thread.
export async function claimWhatsAppConversationAction(conversationId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: me } = await supabase.from("school_users").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (!me) return { error: "Could not resolve your staff record." };

  const { error } = await supabase
    .from("whatsapp_conversations")
    .update({ status: "staff_handling", assigned_to: me.id, unread_count: 0 })
    .eq("id", conversationId);
  if (error) return { error: error.message };
  revalidatePath("/communication");
  return { success: true };
}

// Marks a thread resolved. It reopens to the bot automatically the next time the guardian messages
// again (see whatsapp-webhook) -- closing here doesn't block future contact, it just clears it from
// the active queue.
export async function closeWhatsAppConversationAction(conversationId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("whatsapp_conversations").update({ status: "closed" }).eq("id", conversationId);
  if (error) return { error: error.message };
  revalidatePath("/communication");
  return { success: true };
}

// Hands a thread back to the bot -- e.g. staff answered the one thing that needed a human and the
// rest of the conversation (fee balance, attendance) is fine for the bot to pick back up.
export async function returnWhatsAppConversationToBotAction(conversationId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("whatsapp_conversations")
    .update({ status: "bot", assigned_to: null, unread_count: 0 })
    .eq("id", conversationId);
  if (error) return { error: error.message };
  revalidatePath("/communication");
  return { success: true };
}

// Manual permanent delete for the history/inbox "Delete permanently" buttons. Gated server-side
// by delete_communication_permanently() on the communication.delete permission (school_owner/
// principal by default) — a caller without it gets a plain Postgres error back through `error`,
// same as every other RPC-backed action in this file. See
// 20260824153119_communication_retention_archive_purge.sql for the full retention design: this
// bypasses the normal 7-day-archive / 14-day-purge schedule for one record someone wants gone now.
export async function deleteCommunicationPermanentlyAction(input: {
  table: "notification_logs" | "whatsapp_conversations";
  id: string;
  reason?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_communication_permanently", {
    p_table: input.table,
    p_id: input.id,
    p_reason: input.reason ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath("/communication");
  return { success: true };
}

// One-off email to a single supplier. Distinct from composeAndSendAction/queue_communication —
// gated on communication.supplier (or communication.write), never on communication.write alone —
// so a procurement officer with only the narrower permission can use this without also being able
// to reach the guardian/student/staff broadcast path.
export async function sendSupplierMessageAction(input: { supplier_id: string; subject: string; body: string }): Promise<ActionResult> {
  const supabase = await createClient();

  const { error: queueError } = await supabase.rpc("queue_supplier_message", {
    p_supplier_id: input.supplier_id,
    p_subject: input.subject,
    p_body: input.body,
  });
  if (queueError) return { error: queueError.message };

  const dispatchResult = await dispatchPending();
  if ("error" in dispatchResult) {
    // The email is safely queued even if this immediate dispatch attempt failed (e.g. provider
    // hiccup) — it'll go out next time anyone with communication.write/supplier visits this page.
    return { error: `Queued, but sending failed: ${dispatchResult.error}` };
  }

  revalidatePath("/communication");
  return { success: true };
}
