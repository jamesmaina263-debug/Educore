"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { logAdminAction } from "@/lib/log-admin-action";
import { isUuid } from "@/lib/sales/pipeline";
import { describeDemoConversion, parseDemoConversionResult } from "@/lib/sales/demo-conversion";

type ActionResult = { error: string } | { success: true };

export async function updateDemoRequestStatus(id: string, status: string): Promise<ActionResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_update_demo_request_status", {
    p_id: id,
    p_status: status,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/demo-requests");
  return { success: true };
}

export async function setDemoRequestArchived(id: string, archived: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_archive_demo_request", {
    p_id: id,
    p_archived: archived,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/demo-requests");
  return { success: true };
}

export async function deleteDemoRequest(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_delete_demo_request", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/admin/demo-requests");
  return { success: true };
}

export async function assignDemoRequest(id: string, teamMemberId: string | null): Promise<ActionResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_assign_demo_request", {
    p_id: id,
    p_team_member_id: teamMemberId,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/demo-requests");
  return { success: true };
}

// Step-1 leads from the two-step demo form who never submitted the full request
// (see marketing_demo_partial_leads).
export async function setDemoPartialLeadContacted(
  id: string,
  contacted: boolean,
): Promise<ActionResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_set_demo_partial_lead_status", {
    p_id: id,
    p_status: contacted ? "contacted" : "incomplete",
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/demo-requests");
  return { success: true };
}

export async function deleteDemoPartialLead(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_delete_demo_partial_lead", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/admin/demo-requests");
  return { success: true };
}

/**
 * One-click, human-triggered: put a website demo request into the sales pipeline. The database creates
 * the lead, or links to an existing one (same school name / email / phone) instead of duplicating, and
 * is idempotent, so a double click is harmless. Nothing is sent to the visitor. Audit detail carries ids
 * only, never contact details.
 */
export async function convertDemoRequestToLead(
  id: string,
): Promise<{ error: string } | { success: true; leadId: string; message: string }> {
  if (!isUuid(id)) return { error: "Invalid demo request id." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("admin_convert_demo_request_to_lead", { p_request_id: id });
  if (error) return { error: error.message };

  const result = parseDemoConversionResult(data);
  if (!result) return { error: "Unexpected response from the server. Check the sales pipeline before retrying." };

  void logAdminAction(supabase, "convert_demo_request_to_lead", {
    request_id: id,
    lead_id: result.leadId,
    created: result.created,
  });
  revalidatePath("/admin/demo-requests");
  revalidatePath("/admin/sales-pipeline");
  return { success: true, leadId: result.leadId, message: describeDemoConversion(result) };
}
