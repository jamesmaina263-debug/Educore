"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { logAdminAction } from "@/lib/log-admin-action";
import { isUuid } from "@/lib/sales/pipeline";
import { isSignupReviewDecision } from "@/lib/signup-review";

type ActionResult = { error: string } | { success: true };

// Approve or reject a self-signup school. All the rules live in the admin_review_school_signup RPC (super
// admin only; only a school that is currently pending or rejected can be changed, so an already-approved
// school can never be locked out from here; approving restarts the 30-day trial). This wrapper only
// validates the input, records who did it, and refreshes the pages that show the count.
export async function reviewSchoolSignup(schoolId: string, decision: string): Promise<ActionResult> {
  if (!isUuid(schoolId)) return { error: "Invalid school." };
  if (!isSignupReviewDecision(decision)) return { error: "Choose approve or reject." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_review_school_signup", {
    p_school_id: schoolId,
    p_decision: decision,
  });
  if (error) return { error: error.message };

  await logAdminAction(supabase, decision === "approved" ? "approve_school_signup" : "reject_school_signup", {
    school_id: schoolId,
  });
  revalidatePath("/admin/signups");
  revalidatePath("/admin");
  return { success: true };
}
