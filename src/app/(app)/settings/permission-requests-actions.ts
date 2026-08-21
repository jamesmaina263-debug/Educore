"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

export interface PermissionRequestRow {
  id: string;
  school_user_id: string;
  permission_key: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  created_at: string;
  reviewed_at: string | null;
  requester_name: string;
}

/**
 * Everyone active can request an additional permission for themselves --
 * request_permission() (SQL, SECURITY DEFINER) enforces that they don't
 * already hold it and don't already have a pending request for it.
 */
export async function requestPermission(permissionKey: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_permission", {
    p_permission_key: permissionKey,
    p_reason: reason.trim() || null,
  });
  if (error) return { error: error.message };

  // Best-effort: let admins who can approve know a request is waiting.
  // Never block the request itself on this.
  await supabase.rpc("notify_users_with_permission", {
    p_permission_key: "settings.roles.manage",
    p_subject: "Permission request needs review",
    p_body: `A staff member requested access to "${permissionKey}".`,
    p_action_url: "/settings/permission-requests",
    p_category: "other",
  });

  revalidatePath("/settings/permission-requests");
  return { success: true };
}

/** Cancel your own still-pending request. */
export async function cancelPermissionRequest(requestId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("permission_requests").update({ status: "cancelled" }).eq("id", requestId);
  if (error) return { error: error.message };
  revalidatePath("/settings/permission-requests");
  return { success: true };
}

/**
 * Approve or reject someone else's request. respond_to_permission_request()
 * (SQL, SECURITY DEFINER) enforces settings.roles.manage AND -- on approval
 * only -- that the reviewer already holds the permission being granted, so
 * this can never be used to grant something the reviewer doesn't have
 * themselves.
 */
export async function respondToPermissionRequest(requestId: string, approve: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_to_permission_request", {
    p_request_id: requestId,
    p_approve: approve,
  });
  if (error) return { error: error.message };
  revalidatePath("/settings/permission-requests");
  return { success: true };
}

export async function getMyPermissionRequests(): Promise<{ error: string } | { success: true; rows: PermissionRequestRow[] }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data, error } = await supabase
    .from("permission_requests")
    .select("id, school_user_id, permission_key, reason, status, created_at, reviewed_at, school_users!permission_requests_school_user_id_fkey(full_name)")
    .order("created_at", { ascending: false });
  if (error) return { error: error.message };

  const rows: PermissionRequestRow[] = (data ?? []).map((r) => ({
    id: r.id,
    school_user_id: r.school_user_id,
    permission_key: r.permission_key,
    reason: r.reason,
    status: r.status as PermissionRequestRow["status"],
    created_at: r.created_at,
    reviewed_at: r.reviewed_at,
    requester_name: (r.school_users as unknown as { full_name: string } | null)?.full_name ?? "",
  }));

  return { success: true, rows };
}
