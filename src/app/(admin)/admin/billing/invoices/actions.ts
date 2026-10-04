"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { logAdminAction } from "@/lib/log-admin-action";
import { emailInvoiceAsAdmin } from "@/lib/billing/send-invoice";

// Every mutation here calls a SECURITY DEFINER SQL function that re-checks auth_is_super_admin(),
// takes the row lock, validates the state transition and writes the invoice audit trail. These
// server actions add the platform activity-log entry and cache invalidation; they never write to
// platform_invoices directly (the table has no client write privileges).

type Fail = { error: string };
type Ok<T extends object = object> = { success: true } & T;
export type ActionResult<T extends object = object> = Fail | Ok<T>;

const LIST = "/admin/billing/invoices";
const detail = (id: string) => `${LIST}/${id}`;

async function ctx() {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  return supabase;
}

const clean = (v: string | null | undefined) => (v ?? "").trim();

function refresh(invoiceId?: string) {
  revalidatePath(LIST);
  revalidatePath("/admin/billing");
  if (invoiceId) revalidatePath(detail(invoiceId));
}

export async function createInvoiceAction(input: {
  schoolId: string;
  periodStart: string;
  periodEnd: string;
  asDraft: boolean;
  label?: string;
  notes?: string;
}): Promise<ActionResult<{ id: string }>> {
  if (!input.schoolId || !input.periodStart || !input.periodEnd) return { error: "Choose a school and a billing period." };
  const supabase = await ctx();
  const { data, error } = await supabase.rpc("create_platform_invoice", {
    p_school_id: input.schoolId,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_as_draft: input.asDraft,
    p_label: clean(input.label) || null,
    p_due_days: null,
    p_notes: clean(input.notes) || null,
  });
  if (error) return { error: error.message };
  void logAdminAction(supabase, "create_platform_invoice", {
    invoice_id: data,
    school_id: input.schoolId,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    as_draft: input.asDraft,
  });
  refresh(String(data));
  return { success: true, id: String(data) };
}

export async function issueInvoiceAction(invoiceId: string): Promise<ActionResult> {
  const supabase = await ctx();
  const { error } = await supabase.rpc("issue_platform_invoice", { p_invoice_id: invoiceId, p_due_days: null });
  if (error) return { error: error.message };
  void logAdminAction(supabase, "issue_platform_invoice", { invoice_id: invoiceId });
  refresh(invoiceId);
  return { success: true };
}

export async function recalculateInvoiceAction(invoiceId: string): Promise<ActionResult> {
  const supabase = await ctx();
  const { error } = await supabase.rpc("recalculate_platform_invoice", { p_invoice_id: invoiceId });
  if (error) return { error: error.message };
  void logAdminAction(supabase, "recalculate_platform_invoice", { invoice_id: invoiceId });
  refresh(invoiceId);
  return { success: true };
}

export async function sendInvoiceAction(invoiceId: string, opts: { to?: string; resend?: boolean } = {}): Promise<ActionResult<{ sentTo: string; warning?: string }>> {
  const supabase = await ctx();
  const result = await emailInvoiceAsAdmin({ client: supabase, invoiceId, to: clean(opts.to) || undefined, resend: opts.resend });
  if (!result.ok) return { error: result.error };
  void logAdminAction(supabase, "send_platform_invoice", { invoice_id: invoiceId, sent_to: result.sentTo, resend: opts.resend === true });
  refresh(invoiceId);
  return { success: true, sentTo: result.sentTo, warning: result.warning };
}

/** For an invoice delivered outside the system (WhatsApp, in person): records that it was sent. */
export async function markInvoiceSentAction(invoiceId: string, note: string): Promise<ActionResult> {
  const supabase = await ctx();
  const { error } = await supabase.rpc("mark_platform_invoice_sent", { p_invoice_id: invoiceId, p_sent_to: clean(note) || "delivered outside the system" });
  if (error) return { error: error.message };
  void logAdminAction(supabase, "mark_platform_invoice_sent", { invoice_id: invoiceId });
  refresh(invoiceId);
  return { success: true };
}

export async function recordInvoicePaymentAction(
  invoiceId: string,
  input: { amount: number; paidOn: string; method: string; reference: string; notes: string },
): Promise<ActionResult> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: "Enter a payment amount greater than zero." };
  const supabase = await ctx();
  const { error } = await supabase.rpc("record_platform_invoice_payment", {
    p_invoice_id: invoiceId,
    p_amount: input.amount,
    p_paid_on: input.paidOn || null,
    p_method: input.method || "other",
    p_reference: clean(input.reference) || null,
    p_notes: clean(input.notes) || null,
  });
  if (error) return { error: error.message };
  void logAdminAction(supabase, "record_platform_invoice_payment", {
    invoice_id: invoiceId,
    amount_kes: input.amount,
    method: input.method,
    reference: clean(input.reference),
  });
  refresh(invoiceId);
  return { success: true };
}

export async function voidPaymentAction(invoiceId: string, paymentId: string, reason: string): Promise<ActionResult> {
  const supabase = await ctx();
  const { error } = await supabase.rpc("void_platform_invoice_payment", { p_payment_id: paymentId, p_reason: reason });
  if (error) return { error: error.message };
  void logAdminAction(supabase, "void_platform_invoice_payment", { invoice_id: invoiceId, payment_id: paymentId, reason });
  refresh(invoiceId);
  return { success: true };
}

export async function cancelInvoiceAction(invoiceId: string, reason: string): Promise<ActionResult> {
  const supabase = await ctx();
  const { error } = await supabase.rpc("cancel_platform_invoice", { p_invoice_id: invoiceId, p_reason: reason });
  if (error) return { error: error.message };
  void logAdminAction(supabase, "cancel_platform_invoice", { invoice_id: invoiceId, reason });
  refresh(invoiceId);
  return { success: true };
}

export async function adjustInvoiceAction(invoiceId: string, discountKes: number, reason: string): Promise<ActionResult> {
  if (!Number.isFinite(discountKes) || discountKes < 0) return { error: "Enter a discount of zero or more." };
  const supabase = await ctx();
  const { error } = await supabase.rpc("adjust_platform_invoice", { p_invoice_id: invoiceId, p_discount_kes: discountKes, p_reason: reason });
  if (error) return { error: error.message };
  void logAdminAction(supabase, "adjust_platform_invoice", { invoice_id: invoiceId, discount_kes: discountKes, reason });
  refresh(invoiceId);
  return { success: true };
}

export async function setDueDateAction(invoiceId: string, dueOn: string, reason: string): Promise<ActionResult> {
  if (!dueOn) return { error: "Choose a due date." };
  const supabase = await ctx();
  const { error } = await supabase.rpc("set_platform_invoice_due_date", { p_invoice_id: invoiceId, p_due_on: dueOn, p_reason: reason });
  if (error) return { error: error.message };
  void logAdminAction(supabase, "set_platform_invoice_due_date", { invoice_id: invoiceId, due_on: dueOn, reason });
  refresh(invoiceId);
  return { success: true };
}

export async function setInvoiceNotesAction(invoiceId: string, notes: string): Promise<ActionResult> {
  const supabase = await ctx();
  const { error } = await supabase.rpc("set_platform_invoice_notes", { p_invoice_id: invoiceId, p_notes: notes });
  if (error) return { error: error.message };
  void logAdminAction(supabase, "set_platform_invoice_notes", { invoice_id: invoiceId });
  refresh(invoiceId);
  return { success: true };
}

export async function regeneratePdfAction(invoiceId: string): Promise<ActionResult<{ version: number }>> {
  const supabase = await ctx();
  const { data, error } = await supabase.rpc("regenerate_platform_invoice_pdf", { p_invoice_id: invoiceId });
  if (error) return { error: error.message };
  void logAdminAction(supabase, "regenerate_platform_invoice_pdf", { invoice_id: invoiceId, version: data });
  refresh(invoiceId);
  return { success: true, version: Number(data) };
}

export async function reissueInvoiceAction(invoiceId: string, reason: string): Promise<ActionResult<{ id: string }>> {
  const supabase = await ctx();
  const { data, error } = await supabase.rpc("reissue_platform_invoice", { p_invoice_id: invoiceId, p_reason: reason });
  if (error) return { error: error.message };
  void logAdminAction(supabase, "reissue_platform_invoice", { invoice_id: invoiceId, new_invoice_id: data, reason });
  refresh(invoiceId);
  return { success: true, id: String(data) };
}

export async function saveSchoolBillingTermsAction(
  schoolId: string,
  invoiceId: string,
  input: { priceOverride: string; discountPercent: string; discountNote: string; billingEmail: string },
): Promise<ActionResult> {
  const price = clean(input.priceOverride) === "" ? null : Number(input.priceOverride);
  const discount = clean(input.discountPercent) === "" ? 0 : Number(input.discountPercent);
  if (price !== null && (!Number.isFinite(price) || price < 0)) return { error: "Custom price must be a number of zero or more (or left blank to use the plan price)." };
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) return { error: "Discount must be between 0 and 100 percent." };
  const supabase = await ctx();
  const { error } = await supabase.rpc("set_school_billing_terms", {
    p_school_id: schoolId,
    p_price_override_kes: price,
    p_discount_percent: discount,
    p_discount_note: clean(input.discountNote) || null,
    p_billing_email: clean(input.billingEmail) || null,
  });
  if (error) return { error: error.message };
  void logAdminAction(supabase, "set_school_billing_terms", { school_id: schoolId, price_override_kes: price, discount_percent: discount, billing_email: clean(input.billingEmail) });
  refresh(invoiceId);
  return { success: true };
}

// ---- Settings + automation ---------------------------------------------------------------

export async function saveBillingSettingsAction(settings: Record<string, unknown>): Promise<ActionResult> {
  const supabase = await ctx();
  const { error } = await supabase.rpc("set_platform_billing_settings", { p_settings: settings });
  if (error) {
    // Translate the two constraint names an admin can realistically hit into plain language.
    if (error.message.includes("auto_needs_date")) return { error: "Choose an “Automatic billing starts from” date before turning automatic billing on." };
    if (error.message.includes("send_needs_issue")) return { error: "Automatic emailing needs “issue automatically” to be on as well." };
    return { error: error.message };
  }
  void logAdminAction(supabase, "set_platform_billing_settings", { changed_keys: Object.keys(settings) });
  revalidatePath("/admin/billing/settings");
  revalidatePath(LIST);
  return { success: true };
}

export async function updatePlanPriceAction(planId: string, pricePerStudent: number): Promise<ActionResult> {
  if (!Number.isFinite(pricePerStudent) || pricePerStudent < 0) return { error: "Enter a price of zero or more." };
  const supabase = await ctx();
  // Plans are catalogue data with their own super-admin RLS policy. Changing a rate affects only
  // invoices created AFTER the change; existing invoices keep the rate snapshotted on them.
  const { data, error } = await supabase.from("subscription_plans").update({ price_per_student_kes: pricePerStudent }).eq("id", planId).select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Plan not found, or you do not have permission to change it." };
  void logAdminAction(supabase, "update_plan_price", { plan_id: planId, price_per_student_kes: pricePerStudent });
  revalidatePath("/admin/billing/settings");
  revalidatePath("/admin/billing");
  return { success: true };
}

export type CycleRow = {
  school_id: string;
  school_name: string;
  label: string;
  period_start: string;
  period_end: string;
  students: number | null;
  unit_price_kes: number | null;
  total_kes: number | null;
  decision: string;
  reason: string | null;
};

/** Exact preview of what a billing run would do right now. Writes nothing. */
export async function previewBillingCycleAction(): Promise<ActionResult<{ rows: CycleRow[] }>> {
  const supabase = await ctx();
  const { data, error } = await supabase.rpc("plan_platform_billing_cycle", { p_as_of: null });
  if (error) return { error: error.message };
  return { success: true, rows: (data ?? []) as CycleRow[] };
}

/** Runs the billing cycle now, using exactly the same rules as the scheduled run. */
export async function runBillingCycleNowAction(): Promise<ActionResult<{ created: number; skipped: number; errors: string[]; status: string }>> {
  const supabase = await ctx();
  const { data, error } = await supabase.rpc("run_platform_billing_cycle", { p_dry_run: false, p_trigger: "manual", p_as_of: null });
  if (error) return { error: error.message };
  const r = (data ?? {}) as { created?: unknown[]; skipped?: unknown[]; errors?: { error: string }[]; status_on_create?: string };
  void logAdminAction(supabase, "run_platform_billing_cycle", { created: r.created?.length ?? 0, skipped: r.skipped?.length ?? 0 });
  refresh();
  return {
    success: true,
    created: r.created?.length ?? 0,
    skipped: r.skipped?.length ?? 0,
    errors: (r.errors ?? []).map((e) => e.error),
    status: r.status_on_create ?? "draft",
  };
}
