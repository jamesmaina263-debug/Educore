"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { getRealClientIp } from "@/lib/get-real-client-ip";
import { sendSecurityAlert } from "@/lib/security-alert";
import { removeLoginAccounts, removeSchoolFiles, type PurgeClient } from "@/lib/admin/purge-school-leftovers";
import {
  RESET_GROUP_KEYS,
  bucketsFor,
  sanitizeGroups,
  withDependencies,
  type ResetGroupKey,
} from "@/lib/settings/trial-reset-groups";

// "Start fresh" for trial schools. The school owner ticks groups of test data to wipe; the school itself, its
// staff, subscription and settings are never touched.
//
// Defence in depth, in this order:
//   1. signed in AND the school_owner of their school (checked here, and again inside the database function);
//   2. the school is still on a free trial (database function -- paying schools can never use this);
//   3. the school name typed back matches exactly;
//   4. rate-limited (5 attempts per hour per user), because this form would otherwise be a free password oracle;
//   5. the owner's current password is re-checked (a live, unattended session is not enough);
//   6. the database function runs everything in ONE transaction and refuses unknown/dependent selections.
// The function is granted to service_role only, so it cannot be called straight from the browser.

export interface TrialResetPreview {
  eligible: true;
  schoolName: string;
  /** Row counts per group (parents included in "students"). */
  counts: Record<ResetGroupKey, number>;
}
export type TrialResetPreviewOutcome = TrialResetPreview | { eligible: false; reason: string };

export interface TrialResetSummary {
  rowsRemoved: number;
  byGroup: Partial<Record<ResetGroupKey, number>>;
  /** Parent records left in place because other records still refer to them. */
  parentsKept: number;
  filesRemoved: number;
  loginsRemoved: number;
  /** Things SQL could not do and that should be looked at. Empty when everything went to plan. */
  warnings: string[];
}
export type TrialResetOutcome = { error: string } | { success: true; summary: TrialResetSummary };

type OwnerContext = { userId: string; schoolId: string; schoolName: string };

const ONLY_OWNER = "Only the school owner can use Start fresh.";
const ONLY_TRIAL = "Start fresh is only available while your school is on its free trial.";

async function resolveOwner(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ error: string } | OwnerContext> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { data: row } = await supabase
    .from("school_users")
    .select("school_id, roles(name), schools(name)")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const roleName = (row?.roles as unknown as { name: string } | null)?.name;
  const schoolName = (row?.schools as unknown as { name: string } | null)?.name;
  if (!row?.school_id || !schoolName) return { error: "No active school found for your account." };
  if (roleName !== "school_owner") return { error: ONLY_OWNER };
  return { userId: user.id, schoolId: row.school_id, schoolName };
}

function friendlyResetError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("free trial")) return ONLY_TRIAL;
  if (m.includes("school owner")) return ONLY_OWNER;
  if (m.includes("does not match")) return "The school name you typed does not match. Nothing was deleted.";
  if (m.includes("requires removing") || m.includes("also requires")) {
    return "Some of the data you chose depends on other data. Tick the groups shown and try again. Nothing was deleted.";
  }
  if (m.includes("foreign key")) {
    return "Some records are still linked to data that could not be removed. Nothing was deleted. Please contact support.";
  }
  return "Could not reset your school's data. Nothing was deleted. Please try again or contact support.";
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Read-only: what would be removed, group by group. Used to fill the tick boxes with live counts. */
export async function getTrialResetPreview(): Promise<TrialResetPreviewOutcome> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const owner = await resolveOwner(supabase);
  if ("error" in owner) return { eligible: false, reason: owner.error };

  try {
    const admin = createAdminClient();
    // Dry run with no groups chosen = count every group, delete nothing.
    const { data, error } = await admin.rpc("reset_trial_school_data", {
      p_school_id: owner.schoolId,
      p_actor: owner.userId,
      p_groups: [],
      p_confirm_name: "",
      p_dry_run: true,
    });
    if (error) return { eligible: false, reason: friendlyResetError(error.message) };
    const snap = (data ?? {}) as Record<string, unknown>;
    const byGroup = (snap.rows_by_group ?? {}) as Record<string, unknown>;
    const counts = Object.fromEntries(RESET_GROUP_KEYS.map((k) => [k, num(byGroup[k])])) as Record<
      ResetGroupKey,
      number
    >;
    return { eligible: true, schoolName: owner.schoolName, counts };
  } catch {
    return { eligible: false, reason: "Could not load your data right now. Please try again." };
  }
}

export async function resetTrialSchoolData(input: {
  groups: unknown;
  confirmName: string;
  password: string;
}): Promise<TrialResetOutcome> {
  const groups = sanitizeGroups(input?.groups);
  if (!groups) return { error: "Invalid selection." };
  if (groups.length === 0) return { error: "Tick at least one group of data to remove." };
  // The page ticks dependencies for the owner; if a request arrives without them, refuse rather than guess.
  if (withDependencies(groups).added.length > 0) {
    return { error: "Some of the data you chose depends on other data. Tick the groups shown and try again." };
  }
  const confirmName = String(input?.confirmName ?? "").trim();
  const password = String(input?.password ?? "");
  if (!confirmName) return { error: "Type your school's name to confirm." };
  if (!password) return { error: "Enter your password to confirm." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const owner = await resolveOwner(supabase);
  if ("error" in owner) return { error: owner.error };

  if (confirmName !== owner.schoolName) {
    return { error: "The school name you typed does not match. Nothing was deleted." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Your session has expired. Please sign in again." };

  const admin = createAdminClient();

  // Rate limit BEFORE the password check. Unlike change-password this fails CLOSED: it guards a destructive
  // action, so if the limiter itself is unavailable we stop rather than allow unlimited guesses.
  const clientIp = getRealClientIp((await headers()).get("x-forwarded-for"));
  try {
    const { data: withinLimit, error: limitError } = await admin.rpc("increment_and_check_rate_limit", {
      p_bucket: `trial-reset:${owner.userId}`,
      p_max_events: 5,
      p_window_seconds: 3600,
    });
    if (limitError || withinLimit === false) {
      if (withinLimit === false) {
        void sendSecurityAlert("Trial-reset rate limit tripped", { bucket: `trial-reset:${owner.userId}`, ip: clientIp });
      }
      return { error: "Too many attempts. Please wait a while and try again." };
    }
  } catch {
    return { error: "Could not verify your request right now. Please try again in a moment." };
  }

  const { error: reauthError } = await supabase.auth.signInWithPassword({ email: user.email, password });
  if (reauthError) return { error: "Password is incorrect." };

  const { data, error } = await admin.rpc("reset_trial_school_data", {
    p_school_id: owner.schoolId,
    p_actor: owner.userId,
    p_groups: groups,
    p_confirm_name: confirmName,
    p_dry_run: false,
  });
  if (error) return { error: friendlyResetError(error.message) };

  // From here the data is gone for good; nothing below may turn that into an error for the caller.
  const snap = (data ?? {}) as Record<string, unknown>;
  const byGroupRaw = (snap.rows_by_group ?? {}) as Record<string, unknown>;
  const byGroup: Partial<Record<ResetGroupKey, number>> = {};
  for (const k of groups) byGroup[k] = num(byGroupRaw[k]);

  const warnings: string[] = [];
  let filesRemoved = 0;
  let loginsRemoved = 0;
  try {
    const purgeClient = admin as unknown as PurgeClient;
    // Only the buckets that belong to the ticked groups -- never logos, staff documents or the admission form template.
    const files = await removeSchoolFiles(purgeClient, owner.schoolId, bucketsFor(groups));
    filesRemoved = files.filesRemoved;
    for (const f of files.failures) warnings.push(`Some uploaded files were not removed (${f}).`);

    const accounts = await removeLoginAccounts(purgeClient, snap.auth_user_ids_to_remove);
    loginsRemoved = accounts.removed;
    for (const f of accounts.failures) warnings.push(`A parent login was not removed (${f}).`);
  } catch (e) {
    warnings.push(
      `Uploaded files and parent logins could not be cleaned up: ${e instanceof Error ? e.message : "unknown error"}.`,
    );
  }

  void sendSecurityAlert("Trial school data reset", {
    school: owner.schoolName,
    groups: groups.join(","),
    rows: String(num(snap.rows_total)),
    warnings: String(warnings.length),
  });

  for (const path of [
    "/dashboard",
    "/students",
    "/admissions",
    "/finance",
    "/academics",
    "/settings/start-fresh",
  ]) {
    revalidatePath(path);
  }

  return {
    success: true,
    summary: {
      rowsRemoved: num(snap.rows_total),
      byGroup,
      parentsKept: num(snap.parents_kept_still_referenced),
      filesRemoved,
      loginsRemoved,
      warnings,
    },
  };
}
