"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { escapePostgrestOrValue } from "@/lib/postgrest-filter";

type ActionResult = { error: string } | { success: true };

async function schoolId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase.rpc("auth_school_id");
  if (error || !data) throw new Error("Could not resolve your school.");
  return data as string;
}

// ---------------------------------------------------------------------------
// Fee structures
// ---------------------------------------------------------------------------

export async function createFeeStructure(input: {
  academic_year_id: string;
  term_id: string;
  class_id: string | null;
  boarding_type: "day" | "boarder";
  fee_category: "core" | "transport";
  name: string;
  items: { name: string; amount: number }[];
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const { data: structure, error } = await supabase
      .from("fee_structures")
      .insert({
        school_id,
        academic_year_id: input.academic_year_id,
        term_id: input.term_id,
        class_id: input.class_id,
        boarding_type: input.boarding_type,
        fee_category: input.fee_category,
        name: input.name,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };

    const { error: itemsError } = await supabase
      .from("fee_items")
      .insert(input.items.map((i) => ({ fee_structure_id: structure.id, name: i.name, amount: i.amount })));
    if (itemsError) return { error: itemsError.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create the fee structure." };
  }
  revalidatePath("/finance", "layout");
  return { success: true };
}

// Flip a fee structure active/inactive. Inactive structures are invisible to invoice
// generation (create_or_get_invoice_for_student / generate_invoices both filter on
// is_active), so this is the on/off switch for "will this actually get picked up when
// invoicing students" -- e.g. reviewing a drafted structure before it's allowed to invoice
// real students, or retiring a superseded one without deleting its history.
export async function setFeeStructureActiveAction(structureId: string, isActive: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("fee_structures").update({ is_active: isActive, updated_at: new Date().toISOString() }).eq("id", structureId);
  if (error) return { error: error.message };
  revalidatePath("/finance", "layout");
  return { success: true };
}

// Replace a fee structure's line items wholesale (delete + reinsert) -- used when reviewing
// a drafted structure's cloned amounts before activating it, or correcting a live one.
export async function updateFeeStructureItemsAction(
  structureId: string,
  items: { name: string; amount: number }[],
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error: deleteError } = await supabase.from("fee_items").delete().eq("fee_structure_id", structureId);
  if (deleteError) return { error: deleteError.message };
  if (items.length > 0) {
    const { error: insertError } = await supabase
      .from("fee_items")
      .insert(items.map((i) => ({ fee_structure_id: structureId, name: i.name, amount: i.amount })));
    if (insertError) return { error: insertError.message };
  }
  revalidatePath("/finance", "layout");
  return { success: true };
}

export async function generateInvoicesAction(termId: string, classId: string | null): Promise<{ error: string } | { success: true; count: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("generate_invoices", { p_term_id: termId, p_class_id: classId });
  if (error) return { error: error.message };
  revalidatePath("/finance", "layout");
  return { success: true, count: data as number };
}

// Single-student equivalent, idempotent (returns the existing invoice if one is already there) —
// used from the Student Accounts tab when a student has a Financial Account but no invoice yet
// for the active term.
export async function createInvoiceForStudentAction(studentId: string, termId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_or_get_invoice_for_student", { p_student_id: studentId, p_term_id: termId });
  if (error) return { error: error.message };
  revalidatePath("/finance", "layout");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export async function recordPaymentAction(input: {
  student_id: string;
  method: "mpesa" | "cash" | "bank" | "cheque" | "card" | "other";
  amount: number;
  reference?: string;
  phone_number?: string;
  mpesa_checkout_request_id?: string;
  allocations?: { invoice_id: string; amount: number }[];
  purpose?: string;
  notes?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_payment", {
    p_student_id: input.student_id,
    p_method: input.method,
    p_amount: input.amount,
    p_reference: input.reference ?? null,
    p_phone_number: input.phone_number ?? null,
    p_mpesa_checkout_request_id: input.mpesa_checkout_request_id ?? null,
    p_allocations: input.allocations ?? null,
    p_purpose: input.purpose ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath("/finance", "layout");
  return { success: true };
}

// A payment that can't be confidently matched to a student on entry — goes into the Unallocated
// Payments queue instead (brief §4.7 item 9).
export async function recordUnallocatedPaymentAction(input: {
  method: "mpesa" | "cash" | "bank" | "cheque" | "card" | "other";
  amount: number;
  reference?: string;
  phone_number?: string;
  purpose?: string;
  notes?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_unallocated_payment", {
    p_method: input.method,
    p_amount: input.amount,
    p_reference: input.reference ?? null,
    p_phone_number: input.phone_number ?? null,
    p_purpose: input.purpose ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath("/finance", "layout");
  return { success: true };
}

export async function allocateUnallocatedPaymentAction(input: {
  payment_id: string;
  student_id: string;
  allocations?: { invoice_id: string; amount: number }[];
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("allocate_unallocated_payment", {
    p_payment_id: input.payment_id,
    p_student_id: input.student_id,
    p_allocations: input.allocations ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath("/finance", "layout");
  return { success: true };
}

// ---------------------------------------------------------------------------
// M-Pesa statement reconciliation
// ---------------------------------------------------------------------------

export interface MpesaStatementLineInput {
  receipt_no: string;
  transaction_time?: string | null;
  details?: string | null;
  amount: number;
}

export interface MpesaStatementImportSummary {
  batch_id: string;
  total_lines: number;
  matched_count: number;
  mismatched_count: number;
  not_in_system_count: number;
}

export async function importMpesaStatementAction(input: {
  lines: MpesaStatementLineInput[];
  source_label?: string;
}): Promise<{ error: string } | { success: true; summary: MpesaStatementImportSummary }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("import_mpesa_statement", {
      p_lines: input.lines,
      p_source_label: input.source_label ?? null,
    })
    .single();
  if (error) return { error: error.message };
  revalidatePath("/finance", "layout");
  return { success: true, summary: data as MpesaStatementImportSummary };
}

export interface MpesaStatementLineRow {
  id: string;
  receipt_no: string;
  transaction_time: string | null;
  details: string | null;
  amount: number;
  match_status: "matched" | "amount_mismatch" | "not_in_system";
  matched_payment_id: string | null;
}

export async function getMpesaStatementBatchLinesAction(
  batchId: string,
): Promise<{ error: string } | { success: true; lines: MpesaStatementLineRow[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mpesa_statement_lines")
    .select("id, receipt_no, transaction_time, details, amount, match_status, matched_payment_id")
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true });
  if (error) return { error: error.message };
  return { success: true, lines: (data ?? []) as MpesaStatementLineRow[] };
}

export async function reversePaymentAction(input: {
  payment_id: string;
  amount: number;
  reason: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reverse_payment", {
    p_payment_id: input.payment_id,
    p_amount: input.amount,
    p_reason: input.reason,
  });
  if (error) return { error: error.message };
  revalidatePath("/finance", "layout");
  return { success: true };
}

// Reconciliation search — student name, admission number, payment reference, external payment
// reference, or invoice number (brief §4.7 item 9). Searches across the small set of matched
// students; the client narrows further by exact invoice/reference match if needed.
export async function searchStudentAccountsAction(query: string): Promise<
  { error: string } | { success: true; results: { student_id: string; full_name: string; admission_number: string; payment_reference: string }[] }
> {
  const supabase = await createClient();
  const q = query.trim();
  if (!q) return { success: true, results: [] };

  // Two separate queries — payment_reference lives on student_financial_accounts, the rest on
  // students — then merged/deduped, since PostgREST can't OR across base + joined columns in
  // one filter.
  const [byReference, byStudent] = await Promise.all([
    supabase
      .from("student_financial_accounts")
      .select("student_id, payment_reference, students!inner(first_name, last_name, admission_number)")
      .ilike("payment_reference", `%${q}%`),
    supabase
      .from("student_financial_accounts")
      .select("student_id, payment_reference, students!inner(first_name, last_name, admission_number)")
      .or(
        `admission_number.ilike.${escapePostgrestOrValue(`%${q}%`)},first_name.ilike.${escapePostgrestOrValue(`%${q}%`)},last_name.ilike.${escapePostgrestOrValue(`%${q}%`)}`,
        { referencedTable: "students" },
      ),
  ]);
  if (byReference.error) return { error: byReference.error.message };
  if (byStudent.error) return { error: byStudent.error.message };

  const seen = new Map<string, { student_id: string; full_name: string; admission_number: string; payment_reference: string }>();
  for (const r of [...(byReference.data ?? []), ...(byStudent.data ?? [])]) {
    const st = r.students as unknown as { first_name: string; last_name: string; admission_number: string };
    seen.set(r.student_id, {
      student_id: r.student_id,
      full_name: `${st.first_name} ${st.last_name}`,
      admission_number: st.admission_number,
      payment_reference: r.payment_reference,
    });
  }
  return { success: true, results: Array.from(seen.values()) };
}

// ---------------------------------------------------------------------------
// Discounts
// ---------------------------------------------------------------------------

export async function requestDiscountAction(input: {
  student_id: string;
  invoice_id: string;
  amount: number;
  reason: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_discount", {
    p_student_id: input.student_id,
    p_invoice_id: input.invoice_id,
    p_amount: input.amount,
    p_reason: input.reason,
  });
  if (error) return { error: error.message };
  revalidatePath("/finance", "layout");

  // Best-effort: let everyone who can approve discounts know one is waiting. Never block on this.
  const { data: student } = await supabase.from("students").select("first_name, last_name").eq("id", input.student_id).maybeSingle();
  await supabase.rpc("notify_users_with_permission", {
    p_permission_key: "discounts.approve",
    p_subject: "Fee discount needs approval",
    p_body: `A discount of ${input.amount} was requested for ${student ? `${student.first_name} ${student.last_name}` : "a student"}.`,
    p_action_url: "/finance",
    p_category: "other",
  });

  return { success: true };
}

async function notifyDiscountOutcome(supabase: Awaited<ReturnType<typeof createClient>>, discountId: string, decision: "approved" | "rejected") {
  const { data: discount } = await supabase.from("discounts").select("requested_by, amount").eq("id", discountId).maybeSingle();
  if (!discount?.requested_by) return;
  await supabase.rpc("notify_school_user", {
    p_recipient_id: discount.requested_by,
    p_subject: decision === "approved" ? "Fee discount approved" : "Fee discount rejected",
    p_body:
      decision === "approved"
        ? `Your discount request for ${discount.amount} was approved.`
        : `Your discount request for ${discount.amount} was not approved.`,
    p_action_url: "/finance",
    p_category: "other",
  });
}

export async function approveDiscountAction(discountId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_discount", { p_discount_id: discountId });
  if (error) return { error: error.message };
  revalidatePath("/finance", "layout");
  await notifyDiscountOutcome(supabase, discountId, "approved");
  return { success: true };
}

export async function rejectDiscountAction(discountId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_discount", { p_discount_id: discountId });
  if (error) return { error: error.message };
  revalidatePath("/finance", "layout");
  await notifyDiscountOutcome(supabase, discountId, "rejected");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Fee waivers / scholarships
// ---------------------------------------------------------------------------

export async function createFeeWaiverAction(input: {
  student_id: string;
  name: string;
  waiver_type: "scholarship" | "bursary" | "staff_discount" | "sibling_discount" | "other";
  discount_kind: "percentage" | "fixed_amount";
  discount_value: number;
  starts_term_id?: string;
  ends_term_id?: string;
  notes?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_fee_waiver", {
    p_student_id: input.student_id,
    p_name: input.name,
    p_waiver_type: input.waiver_type,
    p_discount_kind: input.discount_kind,
    p_discount_value: input.discount_value,
    p_starts_term_id: input.starts_term_id ?? null,
    p_ends_term_id: input.ends_term_id ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath("/finance", "layout");
  return { success: true };
}

export async function revokeFeeWaiverAction(waiverId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_fee_waiver", { p_waiver_id: waiverId });
  if (error) return { error: error.message };
  revalidatePath("/finance", "layout");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export async function raiseExpenseAction(input: {
  category: string;
  vendor: string;
  amount: number;
  description?: string;
  receipt_url?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("raise_expense", {
    p_category: input.category,
    p_vendor: input.vendor,
    p_amount: input.amount,
    p_description: input.description ?? null,
    p_receipt_url: input.receipt_url ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath("/finance", "layout");

  // Best-effort: let everyone who can approve expenses know one is waiting. Never block on this.
  await supabase.rpc("notify_users_with_permission", {
    p_permission_key: "expenses.approve",
    p_subject: "Expense claim needs approval",
    p_body: `An expense of ${input.amount} to ${input.vendor} (${input.category}) needs approval.`,
    p_action_url: "/finance",
    p_category: "other",
  });

  return { success: true };
}

async function notifyExpenseOutcome(supabase: Awaited<ReturnType<typeof createClient>>, expenseId: string, decision: "approved" | "rejected") {
  const { data: expense } = await supabase.from("expenses").select("requested_by, amount, vendor").eq("id", expenseId).maybeSingle();
  if (!expense?.requested_by) return;
  await supabase.rpc("notify_school_user", {
    p_recipient_id: expense.requested_by,
    p_subject: decision === "approved" ? "Expense claim approved" : "Expense claim rejected",
    p_body:
      decision === "approved"
        ? `Your expense of ${expense.amount} to ${expense.vendor} was approved.`
        : `Your expense of ${expense.amount} to ${expense.vendor} was not approved.`,
    p_action_url: "/finance",
    p_category: "other",
  });
}

export async function approveExpenseAction(expenseId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_expense", { p_expense_id: expenseId });
  if (error) return { error: error.message };
  revalidatePath("/finance", "layout");
  await notifyExpenseOutcome(supabase, expenseId, "approved");
  return { success: true };
}

export async function rejectExpenseAction(expenseId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_expense", { p_expense_id: expenseId });
  if (error) return { error: error.message };
  revalidatePath("/finance", "layout");
  await notifyExpenseOutcome(supabase, expenseId, "rejected");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Fee alert threshold (Configuration)
// ---------------------------------------------------------------------------

export async function setFeeAlertThresholdAction(threshold: number | null): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_fee_alert_threshold", { p_threshold: threshold });
  if (error) return { error: error.message };
  revalidatePath("/finance", "layout");
  return { success: true };
}
