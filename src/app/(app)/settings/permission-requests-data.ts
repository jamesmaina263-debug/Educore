import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyPermissionRequests, type PermissionRequestRow } from "./permission-requests-actions";

export interface PermissionRequestsContext {
  userName: string;
  userRole?: string;
  schoolName: string;
  canManagePermissions: boolean;
  myRequests: PermissionRequestRow[];
  pendingForReview: PermissionRequestRow[];
}

export async function loadPermissionRequestsContext(): Promise<PermissionRequestsContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: viewer }, { data: canManagePermissions }, requestsResult] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "settings.roles.manage" }),
    getMyPermissionRequests(),
  ]);

  const roleName = (viewer?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (viewer?.schools as unknown as { name: string } | null)?.name ?? "EduCore";
  const userName = viewer?.full_name ?? user.email ?? "Account";
  const currentUserId = viewer?.id ?? "";

  // RLS already scopes this query: a regular user only ever gets their own
  // rows back; someone with settings.roles.manage gets every row in the
  // school. Either way, split it here by school_user_id (not name -- names
  // can collide) into "my own history" vs. "everyone else's pending queue".
  const allRows = "success" in requestsResult ? requestsResult.rows : [];
  const myRequests = allRows.filter((r) => r.school_user_id === currentUserId);
  const pendingForReview =
    canManagePermissions === true ? allRows.filter((r) => r.status === "pending" && r.school_user_id !== currentUserId) : [];

  return {
    userName,
    userRole: roleName,
    schoolName,
    canManagePermissions: canManagePermissions === true,
    myRequests,
    pendingForReview,
  };
}
