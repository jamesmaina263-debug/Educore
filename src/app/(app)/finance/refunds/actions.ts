"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import {
  parseWholeKes,
  refundErrorMessage,
  validatePayoutForm,
  validateRequestForm,
  type PayoutMethod,
  type RefundReason,
} from "@/lib/refunds";

// WP 4.3. Every rule (flag, permission, whole shillings, credit available, one open request per
// payment, second approver, the ledger change itself) lives in the database functions. These
// actions only re-check the shape of the input and pass it through, so a tampered client cannot
// skip anything: the database refuses it.

type ActionResult = { error: string } | { success: true };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS: RefundReason[] = ["overpayment", "duplicate_payment", "paid_in_error", "other"];
const METHODS: PayoutMethod[] = ["mpesa", "bank", "cash", "cheque"];

async function run(fn: (supabase: Awaited<ReturnType<typeof createClient>>) => PromiseLike<{ error: { message: string } | null }>): Promise<ActionResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  try {
    const { error } = await fn(supabase);
    if (error) return { error: refundErrorMessage(error.message) };
  } catch (e) {
    return { error: refundErrorMessage(e instanceof Error ? e.message : null) };
  }
  revalidatePath("/finance", "layout");
  return { success: true };
}

export async function createRefundRequestAction(input: {
  paymentId: string;
  amountText: string;
  reason: string;
  note: string;
}): Promise<ActionResult> {
  const reason = REASONS.find((r) => r === input.reason);
  const invalid = validateRequestForm({ paymentId: input.paymentId, amountText: input.amountText, reason: reason ?? "", note: input.note });
  if (invalid) return { error: invalid };
  if (!UUID_RE.test(input.paymentId)) return { error: "Choose the payment to refund from." };
  const amount = parseWholeKes(input.amountText) as number; // non-null: validated above
  const note = input.note.trim();
  return run((s) =>
    s.rpc("create_refund_request", {
      p_payment_id: input.paymentId,
      p_amount: amount,
      p_reason_code: reason,
      p_reason_note: note === "" ? null : note,
    }),
  );
}

export async function decideRefundRequestAction(input: { requestId: string; approve: boolean; note: string }): Promise<ActionResult> {
  if (!UUID_RE.test(input.requestId)) return { error: "Refund request not found." };
  if (typeof input.approve !== "boolean") return { error: "Choose approve or reject." };
  const note = input.note.trim();
  if (!input.approve && note === "") return { error: "Give a reason for rejecting this request." };
  if (note.length > 500) return { error: "The note is too long (500 characters at most)." };
  return run((s) => s.rpc("decide_refund_request", { p_request_id: input.requestId, p_approve: input.approve, p_note: note === "" ? null : note }));
}

export async function cancelRefundRequestAction(input: { requestId: string; note: string }): Promise<ActionResult> {
  if (!UUID_RE.test(input.requestId)) return { error: "Refund request not found." };
  const note = input.note.trim();
  if (note.length > 500) return { error: "The note is too long (500 characters at most)." };
  return run((s) => s.rpc("cancel_refund_request", { p_request_id: input.requestId, p_note: note === "" ? null : note }));
}

export async function recordRefundPayoutAction(input: { requestId: string; method: string; reference: string }): Promise<ActionResult> {
  if (!UUID_RE.test(input.requestId)) return { error: "Refund request not found." };
  const method = METHODS.find((m) => m === input.method);
  const invalid = validatePayoutForm({ method: method ?? "", reference: input.reference });
  if (invalid) return { error: invalid };
  return run((s) => s.rpc("record_refund_payout", { p_request_id: input.requestId, p_method: method, p_reference: input.reference.trim() }));
}
