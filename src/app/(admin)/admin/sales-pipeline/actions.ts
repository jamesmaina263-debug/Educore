"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { logAdminAction } from "@/lib/log-admin-action";
import {
  isUuid,
  isValidActivityType,
  isValidDateString,
  isValidStage,
  validateLeadInput,
  type LeadInput,
} from "@/lib/sales/pipeline";

type ActionResult = { error: string } | { success: true };

const PATH = "/admin/sales-pipeline";

// Every mutation goes through a SECURITY DEFINER RPC that re-checks auth_is_super_admin() in the
// database (see 20260924130000_sales_pipeline_crm.sql). The validation here is a friendlier first
// line: it produces readable errors and stops malformed input before it reaches the database.
// Audit-log detail deliberately carries ids only, never a contact's name/phone/email.

export async function saveSalesLead(input: LeadInput): Promise<ActionResult & { id?: string }> {
  const parsed = validateLeadInput(input);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.value;

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("admin_save_sales_lead", {
    p_id: v.id,
    p_school_name: v.school_name,
    p_town_county: v.town_county,
    p_school_type: v.school_type,
    p_contact_name: v.contact_name,
    p_contact_role: v.contact_role,
    p_phone: v.phone,
    p_email: v.email,
    p_current_system: v.current_system,
    p_pain_points: v.pain_points,
    p_source: v.source,
    p_student_count: v.student_count,
    p_assigned_to: v.assigned_to,
    p_next_follow_up_on: v.next_follow_up_on,
    p_notes: v.notes,
  });
  if (error) return { error: error.message };

  const leadId = typeof data === "string" ? data : (v.id ?? undefined);
  void logAdminAction(supabase, v.id ? "update_sales_lead" : "create_sales_lead", { lead_id: leadId });
  revalidatePath(PATH);
  return { success: true, id: leadId };
}

export async function setSalesLeadStage(
  id: string,
  stage: string,
  lostReason: string | null,
  performedBy: string | null,
): Promise<ActionResult> {
  if (!isUuid(id)) return { error: "Invalid lead id." };
  if (!isValidStage(stage)) return { error: "Invalid stage." };
  if (performedBy && !isUuid(performedBy)) return { error: "Invalid rep." };
  const reason = (lostReason ?? "").trim();
  if (stage === "lost" && reason === "") return { error: "A reason is required when marking a lead as lost." };
  if (reason.length > 500) return { error: "Lost reason is too long (max 500 characters)." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_set_sales_lead_stage", {
    p_id: id,
    p_stage: stage,
    p_lost_reason: stage === "lost" ? reason : null,
    p_performed_by: performedBy || null,
  });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "set_sales_lead_stage", { lead_id: id, stage });
  revalidatePath(PATH);
  return { success: true };
}

export async function addSalesLeadActivity(
  leadId: string,
  type: string,
  summary: string,
  performedBy: string | null,
  nextFollowUpOn: string | null,
): Promise<ActionResult> {
  if (!isUuid(leadId)) return { error: "Invalid lead id." };
  if (!isValidActivityType(type)) return { error: "Invalid activity type." };
  if (performedBy && !isUuid(performedBy)) return { error: "Invalid rep." };
  const text = summary.trim();
  if (text === "") return { error: "Add a short summary of what happened." };
  if (text.length > 2000) return { error: "Summary is too long (max 2000 characters)." };
  if (nextFollowUpOn && !isValidDateString(nextFollowUpOn)) return { error: "Invalid follow-up date." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_add_sales_lead_activity", {
    p_lead_id: leadId,
    p_type: type,
    p_summary: text,
    p_performed_by: performedBy || null,
    p_next_follow_up_on: nextFollowUpOn || null,
  });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "add_sales_lead_activity", { lead_id: leadId, type });
  revalidatePath(PATH);
  return { success: true };
}

export async function deleteSalesLead(id: string): Promise<ActionResult> {
  if (!isUuid(id)) return { error: "Invalid lead id." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_delete_sales_lead", { p_id: id });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "delete_sales_lead", { lead_id: id });
  revalidatePath(PATH);
  return { success: true };
}
