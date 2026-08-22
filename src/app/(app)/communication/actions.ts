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
