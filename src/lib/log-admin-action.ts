import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminOperator } from "@/lib/admin-operator-server";

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
    // Which person (of the shared login) did this -- see lib/admin-operator.ts. Read inside its
    // own try so a cookie-read problem can only ever cost the name, never the log row itself.
    let operator: string = "unidentified";
    try {
      operator = (await getAdminOperator()) ?? "unidentified";
    } catch {
      // Outside a request scope (e.g. a script) there is no cookie store; keep "unidentified".
    }
    const { error } = await supabase.rpc("log_platform_admin_action", {
      p_action: action,
      p_detail: { ...detail, operator },
    });
    if (error) console.error("logAdminAction: failed to write platform_admin_activity_log", action, error);
  } catch (err) {
    console.error("logAdminAction: failed to write platform_admin_activity_log", action, err);
  }
}
