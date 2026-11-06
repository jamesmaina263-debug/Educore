"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { parseDue, validateAgreementDate, validateLoan, validateMoney, validateReason, type DueResult, type LoanInput } from "@/lib/staff-loans";

type Plain = { error: string } | { success: true };
const REF = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Staff loans and salary advances (WP 7.2). Every action is a thin call to a database function that checks the caller,
// the school, the permission and the feature flag itself, and that enforces the Employment Act limits. Nothing here
// pays a loan out, takes a payment or writes to a payroll record.

export async function createLoanAction(input: LoanInput): Promise<Plain> {
  const checked = validateLoan(input);
  if ("error" in checked) return { error: checked.error };
  const v = checked.value;
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("create_staff_loan", {
    p_staff_id: v.staffId,
    p_kind: v.kind,
    p_principal: v.principal,
    p_installment: v.installment,
    p_first_year: v.firstYear,
    p_first_month: v.firstMonth,
    p_reason: v.reason || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/payroll/loans");
  return { success: true };
}

export async function approveLoanAction(loanId: string, agreementOn: string, todayIso: string): Promise<Plain> {
  if (!UUID.test(loanId)) return { error: "Missing loan." };
  const d = validateAgreementDate(agreementOn, todayIso);
  if ("error" in d) return { error: d.error };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("approve_staff_loan", { p_loan_id: loanId, p_agreement_on: d.value });
  if (error) return { error: error.message };
  revalidatePath("/payroll/loans");
  return { success: true };
}

export async function cancelLoanAction(loanId: string, reason: string): Promise<Plain> {
  if (!UUID.test(loanId)) return { error: "Missing loan." };
  const r = validateReason(reason);
  if ("error" in r) return { error: r.error };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("cancel_staff_loan", { p_loan_id: loanId, p_reason: r.value });
  if (error) return { error: error.message };
  revalidatePath("/payroll/loans");
  return { success: true };
}

export async function writeOffAction(loanId: string, reason: string): Promise<{ error: string } | { success: true; amount: number }> {
  if (!UUID.test(loanId)) return { error: "Missing loan." };
  const r = validateReason(reason);
  if ("error" in r) return { error: r.error };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("write_off_staff_loan", { p_loan_id: loanId, p_reason: r.value });
  if (error) return { error: error.message };
  revalidatePath("/payroll/loans");
  return { success: true, amount: Number(data) };
}

export async function repaymentAction(loanId: string, amount: string, note: string, ref: string): Promise<{ error: string } | { success: true; balance: number; duplicate: boolean }> {
  if (!UUID.test(loanId)) return { error: "Missing loan." };
  if (!REF.test(ref)) return { error: "Missing request reference. Reload the page and try again." };
  const a = validateMoney(amount, 5_000_000);
  if ("error" in a) return { error: a.error };
  if (note.length > 200) return { error: "The note is too long (200 characters at most)." };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("record_staff_loan_repayment", { p_loan_id: loanId, p_amount: a.value, p_note: note.trim() || null, p_client_ref: ref });
  if (error) return { error: error.message };
  const d = data as { balance: number | string; duplicate: boolean };
  revalidatePath("/payroll/loans");
  return { success: true, balance: Number(d.balance), duplicate: d.duplicate };
}

/** Read-only: what is lawfully due on a draft payroll record. Writes nothing. */
export async function dueAction(recordId: string): Promise<{ error: string } | { success: true; due: DueResult }> {
  if (!UUID.test(recordId)) return { error: "Choose a payroll record." };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("staff_loan_due_for_record", { p_record_id: recordId });
  if (error) return { error: error.message };
  const due = parseDue(data);
  if (!due) return { error: "Could not work out what is due." };
  return { success: true, due };
}
