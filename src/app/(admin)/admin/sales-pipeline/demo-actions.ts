"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { logAdminAction } from "@/lib/log-admin-action";
import { isUuid } from "@/lib/sales/pipeline";
import {
  validateBookingInput,
  validateCloseInput,
  validateRescheduleInput,
  type BookingInput,
} from "@/lib/sales/demos";

type ActionResult = { error: string } | { success: true };

const PATH = "/admin/sales-pipeline";

// Manual demo booking. Every mutation is a SECURITY DEFINER RPC that re-checks super admin and the rules in the
// database (20261018190000_sales_lead_demos.sql). Nothing is sent to the school and no calendar is touched.
// Audit-log detail carries ids and coded values only: never a contact detail, location/link or note text.

export async function bookSalesLeadDemo(
  leadId: string,
  input: BookingInput,
  hostId: string | null,
  performedBy: string | null,
): Promise<ActionResult> {
  if (!isUuid(leadId)) return { error: "Invalid lead id." };
  if (hostId !== null && !isUuid(hostId)) return { error: "Invalid team member." };
  if (performedBy !== null && !isUuid(performedBy)) return { error: "Invalid rep." };
  const checked = validateBookingInput(input);
  if (!checked.ok) return { error: checked.error };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_book_sales_lead_demo", {
    p_lead_id: leadId,
    p_scheduled_for: checked.scheduledFor,
    p_mode: checked.mode,
    p_location_note: checked.locationNote,
    p_host_id: hostId,
    p_performed_by: performedBy,
  });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "book_sales_lead_demo", { lead_id: leadId, mode: checked.mode });
  revalidatePath(PATH);
  return { success: true };
}

export async function rescheduleSalesLeadDemo(
  demoId: string,
  scheduledLocal: string,
  performedBy: string | null,
): Promise<ActionResult> {
  if (!isUuid(demoId)) return { error: "Invalid demo id." };
  if (performedBy !== null && !isUuid(performedBy)) return { error: "Invalid rep." };
  const checked = validateRescheduleInput(scheduledLocal);
  if (!checked.ok) return { error: checked.error };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_reschedule_sales_lead_demo", {
    p_demo_id: demoId,
    p_scheduled_for: checked.scheduledFor,
    p_performed_by: performedBy,
  });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "reschedule_sales_lead_demo", { demo_id: demoId });
  revalidatePath(PATH);
  return { success: true };
}

export async function closeSalesLeadDemo(
  demoId: string,
  status: string,
  note: string | null,
  performedBy: string | null,
): Promise<ActionResult> {
  if (!isUuid(demoId)) return { error: "Invalid demo id." };
  if (performedBy !== null && !isUuid(performedBy)) return { error: "Invalid rep." };
  const checked = validateCloseInput(status, note);
  if (!checked.ok) return { error: checked.error };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_set_sales_lead_demo_status", {
    p_demo_id: demoId,
    p_status: checked.status,
    p_outcome_note: checked.note,
    p_performed_by: performedBy,
  });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "set_sales_lead_demo_status", { demo_id: demoId, status: checked.status });
  revalidatePath(PATH);
  return { success: true };
}
