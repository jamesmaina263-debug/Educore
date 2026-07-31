"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
  revalidatePath("/finance");
  return { success: true };
}

export async function generateInvoicesAction(termId: string, classId: string | null): Promise<{ error: string } | { success: true; count: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("generate_invoices", { p_term_id: termId, p_class_id: classId });
  if (error) return { error: error.message };
  revalidatePath("/finance");
  return { success: true, count: data as number };
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export async function recordPaymentAction(input: {
  student_id: string;
  method: "mpesa" | "cash" | "bank" | "cheque";
  amount: number;
  reference?: string;
  phone_number?: string;
  mpesa_checkout_request_id?: string;
  allocations?: { invoice_id: string; amount: number }[];
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
  });
  if (error) return { error: error.message };
  revalidatePath("/finance");
  return { success: true };
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
  revalidatePath("/finance");
  return { success: true };
}

export async function approveDiscountAction(discountId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_discount", { p_discount_id: discountId });
  if (error) return { error: error.message };
  revalidatePath("/finance");
  return { success: true };
}

export async function rejectDiscountAction(discountId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_discount", { p_discount_id: discountId });
  if (error) return { error: error.message };
  revalidatePath("/finance");
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
  revalidatePath("/finance");
  return { success: true };
}

export async function approveExpenseAction(expenseId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_expense", { p_expense_id: expenseId });
  if (error) return { error: error.message };
  revalidatePath("/finance");
  return { success: true };
}

export async function rejectExpenseAction(expenseId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_expense", { p_expense_id: expenseId });
  if (error) return { error: error.message };
  revalidatePath("/finance");
  return { success: true };
}
