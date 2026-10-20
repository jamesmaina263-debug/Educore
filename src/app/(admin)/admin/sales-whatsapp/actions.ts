"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { logAdminAction } from "@/lib/log-admin-action";
import { isUuid } from "@/lib/sales/pipeline";
import { LIMITS, messageProblem, validateAgreement, validateMessage, type AgreementInput } from "@/lib/growth/sales-whatsapp";

type ActionResult = { error: string } | { success: true };

const PATH = "/admin/sales-whatsapp";

// Sales WhatsApp, first PR. Every mutation is a SECURITY DEFINER RPC that re-checks super admin and EVERY rule in the
// database (20261019160000_sales_whatsapp_consent_queue.sql); the validation here only gives friendlier first errors.
// NOTHING here sends a WhatsApp message: a person sends an approved message from their own WhatsApp and then marks it
// sent. Audit-log detail carries ids and coded values only: never a phone number, name or message text.

export async function recordWhatsAppAgreement(input: AgreementInput & { schoolId?: string | null; recordedBy: string }): Promise<ActionResult> {
  if (!isUuid(input.recordedBy)) return { error: "Say who is recording this agreement." };
  if (input.schoolId && !isUuid(input.schoolId)) return { error: "Invalid school id." };
  const checked = validateAgreement(input);
  if (!checked.ok) return { error: checked.error };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_record_whatsapp_consent", {
    p_phone: checked.phone,
    p_name: checked.name,
    p_school_name: checked.schoolName,
    p_how: checked.how,
    p_scope: checked.scope,
    p_note: checked.note,
    p_school_id: input.schoolId || null,
    p_recorded_by: input.recordedBy,
  });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "record_whatsapp_agreement", { how: checked.how, scope: checked.scope, school_id: input.schoolId || null });
  revalidatePath(PATH);
  return { success: true };
}

export async function withdrawWhatsAppAgreement(consentId: string, withdrawnBy: string, note?: string): Promise<ActionResult> {
  if (!isUuid(consentId)) return { error: "Invalid agreement id." };
  if (!isUuid(withdrawnBy)) return { error: "Say who is withdrawing this agreement." };
  const n = (note ?? "").trim();
  if (n.length > LIMITS.noteMax) return { error: `Note is too long (max ${LIMITS.noteMax} characters).` };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_withdraw_whatsapp_consent", {
    p_consent_id: consentId,
    p_withdrawn_by: withdrawnBy,
    p_note: n === "" ? null : n,
  });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "withdraw_whatsapp_agreement", { consent_id: consentId });
  revalidatePath(PATH);
  return { success: true };
}

export async function proposeSalesWhatsApp(input: { consentId: string; kind: string; body: string; proposedBy: string }): Promise<ActionResult> {
  if (!isUuid(input.consentId)) return { error: "Invalid agreement id." };
  if (!isUuid(input.proposedBy)) return { error: "Say who is proposing this message." };
  const checked = validateMessage(input);
  if (!checked.ok) return { error: checked.error };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_propose_sales_whatsapp", {
    p_consent_id: input.consentId,
    p_kind: checked.kind,
    p_body: checked.body,
    p_proposed_by: input.proposedBy,
  });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "propose_sales_whatsapp", { consent_id: input.consentId, kind: checked.kind });
  revalidatePath(PATH);
  return { success: true };
}

export async function editSalesWhatsApp(id: string, kind: string, body: string): Promise<ActionResult> {
  if (!isUuid(id)) return { error: "Invalid message id." };
  const problem = messageProblem(kind, body);
  if (problem) return { error: problem };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_edit_sales_whatsapp", { p_id: id, p_body: body.trim() });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "edit_sales_whatsapp", { message_id: id });
  revalidatePath(PATH);
  return { success: true };
}

export async function reviewSalesWhatsApp(
  id: string,
  decision: string,
  expectedHash: string,
  reviewedBy: string,
  note?: string,
): Promise<ActionResult> {
  if (!isUuid(id)) return { error: "Invalid message id." };
  if (decision !== "approve" && decision !== "reject") return { error: "Decision must be approve or reject." };
  if (!isUuid(reviewedBy)) return { error: "Say who is reviewing this message." };
  if (decision === "approve" && !/^[0-9a-f]{64}$/.test(expectedHash)) return { error: "Reload the page and review the message again." };
  const n = (note ?? "").trim();
  if (n.length > LIMITS.noteMax) return { error: `Note is too long (max ${LIMITS.noteMax} characters).` };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("admin_review_sales_whatsapp", {
    p_id: id,
    p_decision: decision,
    p_expected_hash: decision === "approve" ? expectedHash : null,
    p_reviewed_by: reviewedBy,
    p_note: n === "" ? null : n,
  });
  if (error) return { error: error.message };
  if (data === "expired") {
    revalidatePath(PATH);
    return { error: "This proposal is more than 7 days old and has expired. Propose it again." };
  }

  void logAdminAction(supabase, "review_sales_whatsapp", { message_id: id, decision });
  revalidatePath(PATH);
  return { success: true };
}

export async function withdrawSalesWhatsApp(id: string): Promise<ActionResult> {
  if (!isUuid(id)) return { error: "Invalid message id." };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_withdraw_sales_whatsapp", { p_id: id });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "withdraw_sales_whatsapp", { message_id: id });
  revalidatePath(PATH);
  return { success: true };
}

/** A person says they sent this approved message from their own WhatsApp. This does NOT send anything. */
export async function markSalesWhatsAppSent(id: string, sentBy: string): Promise<ActionResult> {
  if (!isUuid(id)) return { error: "Invalid message id." };
  if (!isUuid(sentBy)) return { error: "Say who sent this message." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("admin_mark_sales_whatsapp_sent", { p_id: id, p_sent_by: sentBy });
  if (error) return { error: error.message };
  const r = data as { ok?: boolean; message?: string } | null;
  if (!r?.ok) {
    revalidatePath(PATH);
    return { error: r?.message ?? "The message could not be marked as sent." };
  }

  void logAdminAction(supabase, "mark_sales_whatsapp_sent", { message_id: id });
  revalidatePath(PATH);
  return { success: true };
}

export async function setSalesWhatsAppPromotional(enabled: boolean, updatedBy: string): Promise<ActionResult> {
  if (typeof enabled !== "boolean") return { error: "The switch value is required." };
  if (!isUuid(updatedBy)) return { error: "Say who you are before changing this switch." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_set_sales_whatsapp_settings", { p_promotional: enabled, p_updated_by: updatedBy });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "set_sales_whatsapp_promotional", { enabled });
  revalidatePath(PATH);
  return { success: true };
}
