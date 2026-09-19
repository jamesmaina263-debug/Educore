"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";

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
