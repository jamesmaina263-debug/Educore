"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { describeModeError, isLiveConfirmationValid, type C2bMode } from "@/lib/c2b-events";

type ModeResult = { error: string } | { success: true; mode: C2bMode };

/**
 * Switch the signed-in user's own school between log_only and live. The database function
 * c2b_set_mode is the authority (owner of that school or platform admin, flag on, config row exists,
 * live only once registered, audit row written). This action adds the typed confirmation for live and
 * re-checks the flag so nothing runs for a school without the feature.
 */
export async function setC2bModeAction(mode: C2bMode, confirmation?: string): Promise<ModeResult> {
  if (mode !== "log_only" && mode !== "live") return { error: describeModeError("22023") };
  if (mode === "live" && !isLiveConfirmationValid(confirmation)) {
    return { error: "Type LIVE exactly to confirm switching to live." };
  }

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  if (!(await hasFeatureFlag(supabase, "feature.finance.c2b_capture"))) {
    return { error: describeModeError("42501") };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: describeModeError("42501") };
  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("school_id")
    .eq("auth_user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!schoolUser?.school_id) return { error: describeModeError("42501") };

  const { data, error } = await supabase.rpc("c2b_set_mode", { p_school_id: schoolUser.school_id, p_mode: mode });
  if (error) return { error: describeModeError(error.code) };

  revalidatePath("/finance/paybill");
  return { success: true, mode: (data as C2bMode) ?? mode };
}
