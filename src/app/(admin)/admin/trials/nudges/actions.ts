"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { logAdminAction } from "@/lib/log-admin-action";
import { extractEdgeFunctionError } from "@/lib/edge-function-error";
import { isUuid } from "@/lib/sales/pipeline";
import { NOTE_MAX, validateProposal, contentProblem } from "@/lib/growth/trial-nudges";

type ActionResult = { error: string } | { success: true };
type SendResult = { error: string } | { success: true; status: string };

const PATH = "/admin/trials/nudges";

// Trial nudges. Every mutation is a SECURITY DEFINER RPC that re-checks super admin and EVERY rule in the database
// (20261018220000_trial_nudges.sql); the validation here only gives friendlier first errors. Nothing is sent without
// a person proposing, a person approving the exact text, and a person clicking Send, and sending is switched off by
// default. Audit-log detail carries ids and coded values only: never the recipient address, subject or body.

export async function proposeTrialNudge(input: {
  schoolId: string;
  kind: string;
  subject: string;
  body: string;
  proposedBy: string;
}): Promise<ActionResult> {
  if (!isUuid(input.schoolId)) return { error: "Invalid school id." };
  if (!isUuid(input.proposedBy)) return { error: "Say who is proposing this message." };
  const checked = validateProposal(input);
  if (!checked.ok) return { error: checked.error };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_propose_trial_nudge", {
    p_school_id: input.schoolId,
    p_kind: checked.kind,
    p_subject: checked.subject,
    p_body: checked.body,
    p_proposed_by: input.proposedBy,
  });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "propose_trial_nudge", { school_id: input.schoolId, kind: checked.kind });
  revalidatePath(PATH);
  return { success: true };
}

export async function editTrialNudge(id: string, kind: string, subject: string, body: string): Promise<ActionResult> {
  if (!isUuid(id)) return { error: "Invalid message id." };
  const problem = contentProblem(kind, subject, body);
  if (problem) return { error: problem };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_edit_trial_nudge", { p_id: id, p_subject: subject.trim(), p_body: body.trim() });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "edit_trial_nudge", { nudge_id: id });
  revalidatePath(PATH);
  return { success: true };
}

export async function reviewTrialNudge(
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
  if (n.length > NOTE_MAX) return { error: `Note is too long (max ${NOTE_MAX} characters).` };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("admin_review_trial_nudge", {
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

  void logAdminAction(supabase, "review_trial_nudge", { nudge_id: id, decision });
  revalidatePath(PATH);
  return { success: true };
}

export async function withdrawTrialNudge(id: string): Promise<ActionResult> {
  if (!isUuid(id)) return { error: "Invalid message id." };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_withdraw_trial_nudge", { p_id: id });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "withdraw_trial_nudge", { nudge_id: id });
  revalidatePath(PATH);
  return { success: true };
}

/**
 * Send one approved message. The database re-checks everything and hands it to the existing campaign pipeline
 * (a one-recipient campaign carrying the approved text); the existing send-owner-campaign Edge Function sends it
 * with the campaign sender, an unsubscribe link and List-Unsubscribe headers. The result is then read back.
 */
export async function sendTrialNudge(id: string): Promise<SendResult> {
  if (!isUuid(id)) return { error: "Invalid message id." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  const { data: queued, error: queueError } = await supabase.rpc("admin_queue_trial_nudge", { p_id: id });
  if (queueError) return { error: queueError.message };
  const q = queued as { ok?: boolean; campaign_id?: string; message?: string } | null;
  if (!q?.ok || !q.campaign_id) {
    revalidatePath(PATH);
    return { error: q?.message ?? "The message could not be queued." };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "Not signed in." };

  let sendError: string | null = null;
  const { data: fn, error: fnError } = await supabase.functions.invoke("send-owner-campaign", {
    body: { campaign_id: q.campaign_id },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (fnError) sendError = await extractEdgeFunctionError(fnError, "Failed to send the message.");
  else if (fn && typeof fn === "object" && "error" in fn && fn.error) sendError = String(fn.error);

  const { data: status, error: finalizeError } = await supabase.rpc("admin_finalize_trial_nudge", { p_id: id });
  void logAdminAction(supabase, "send_trial_nudge", { nudge_id: id, status: typeof status === "string" ? status : "unknown" });
  revalidatePath(PATH);

  if (finalizeError) return { error: finalizeError.message };
  if (sendError) return { error: sendError };
  if (status === "sent") return { success: true, status };
  if (status === "failed") return { error: "The email could not be sent. The reason is shown on the message." };
  return { error: "Still sending. Use Check status in a moment." };
}

/** Re-reads a queued message's outcome (for a send that did not finish while the page was open). */
export async function checkTrialNudge(id: string): Promise<SendResult> {
  if (!isUuid(id)) return { error: "Invalid message id." };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data: status, error } = await supabase.rpc("admin_finalize_trial_nudge", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { success: true, status: typeof status === "string" ? status : "unknown" };
}

export async function setTrialNudgeSettings(sending: boolean, promotional: boolean, updatedBy: string): Promise<ActionResult> {
  if (typeof sending !== "boolean" || typeof promotional !== "boolean") return { error: "Both switches are required." };
  if (!isUuid(updatedBy)) return { error: "Say who you are before changing these switches." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_set_trial_nudge_settings", {
    p_sending: sending,
    p_promotional: promotional,
    p_updated_by: updatedBy,
  });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "set_trial_nudge_settings", { sending, promotional });
  revalidatePath(PATH);
  return { success: true };
}
