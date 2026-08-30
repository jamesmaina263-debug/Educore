"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

export async function activateSchoolSubscription(
  schoolId: string,
  planId: string,
  periodEnd: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("activate_subscription", {
    p_school_id: schoolId,
    p_plan_id: planId,
    p_period_end: periodEnd,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/billing");
  return { success: true };
}

export async function suspendSchoolSubscription(schoolId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("suspend_subscription", {
    p_school_id: schoolId,
    p_reason: reason || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/billing");
  return { success: true };
}

export async function generateSchoolInvoice(
  schoolId: string,
  periodStart: string,
  periodEnd: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("generate_platform_invoice", {
    p_school_id: schoolId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_due_days: 14,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/billing");
  return { success: true };
}

export async function recordSchoolPayment(invoiceId: string, reference: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_platform_payment", {
    p_invoice_id: invoiceId,
    p_reference: reference || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/billing");
  return { success: true };
}
