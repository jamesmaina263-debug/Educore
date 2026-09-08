import type { SupabaseClient } from "@supabase/supabase-js";

// Best-effort: a failed log write must never block or fail the admin action it's attached to
// (same posture as sendSecurityAlert -- an audit trail going down is not a reason to stop the
// platform admin from suspending a school or sending a reminder). Call this after the actual
// mutation has already succeeded, not before.
export async function logAdminAction(
  supabase: SupabaseClient,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { error } = await supabase.rpc("log_platform_admin_action", { p_action: action, p_detail: detail });
    if (error) console.error("logAdminAction: failed to write platform_admin_activity_log", action, error);
  } catch (err) {
    console.error("logAdminAction: failed to write platform_admin_activity_log", action, err);
  }
}
