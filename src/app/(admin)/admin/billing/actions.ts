"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { extractEdgeFunctionError } from "@/lib/edge-function-error";

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

// Dunning follow-up: emails the school's owner about a specific overdue invoice, via the
// send-billing-reminder edge function (same session-JWT auth pattern as company-email's
// invokeMonitor -- see that file's comment). Distinct from the daily mark_invoices_overdue/
// suspend_schools_with_overdue_invoices cron, which is silent policy enforcement; this is the
// human-facing nudge in between.
export async function sendBillingReminder(invoiceId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "Not signed in." };

  const { data, error } = await supabase.functions.invoke("send-billing-reminder", {
    body: { invoice_id: invoiceId },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) return { error: await extractEdgeFunctionError(error, "Failed to send the reminder.") };
  if (data?.error) return { error: data.error as string };

  revalidatePath("/admin/billing");
  return { success: true };
}
