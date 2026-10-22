"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { logAdminAction } from "@/lib/log-admin-action";
import { getAdminOperator } from "@/lib/admin-operator-server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isUuid,
  removeLoginAccounts,
  removeSchoolFiles,
  type PurgeClient,
} from "@/lib/admin/purge-school-leftovers";

type ActionResult = { error: string } | { success: true };

// Lightweight lifecycle controls surfaced directly on the Overview school list -- the
// heavier billing/actions.ts pair (activateSchoolSubscription/suspendSchoolSubscription)
// still exists for full plan-change workflows on /admin/billing; these two are the quick
// "shut it off" / "turn it back on" levers for the common non-payment case, so a suspension
// no longer needs a SQL console or a trip to Billing's expanded row.
export async function suspendSchool(schoolId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("suspend_subscription", {
    p_school_id: schoolId,
    p_reason: reason || null,
  });
  if (error) return { error: error.message };
  void logAdminAction(supabase, "suspend_school", { school_id: schoolId, reason });
  revalidatePath("/admin");
  revalidatePath("/admin/billing");
  return { success: true };
}

export async function reactivateSchool(schoolId: string): Promise<ActionResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("reactivate_school", { p_school_id: schoolId });
  if (error) return { error: error.message };
  void logAdminAction(supabase, "reactivate_school", { school_id: schoolId });
  revalidatePath("/admin");
  revalidatePath("/admin/billing");
  return { success: true };
}

// ---------------------------------------------------------------------------------------------
// Permanent deletion. IRREVERSIBLE. Every guard that matters lives in the SQL function
// (delete_school_permanently: super admin only, school must be suspended/cancelled, slug typed back,
// reason, all-or-nothing transaction, activity-log row written inside it). This action adds only what
// SQL cannot do: the operator identity, and removing the school's Storage files and login accounts
// after the database transaction has committed.
// ---------------------------------------------------------------------------------------------
export interface SchoolDeletionPreview {
  school_id: string;
  name: string;
  slug: string;
  status: "trial" | "active" | "suspended" | "cancelled";
  students: number;
  staff: number;
  login_accounts: number;
  platform_invoices: number;
  paid_payments: number;
  paid_kes: number;
  blockers: string[];
  can_delete: boolean;
}

export async function previewSchoolDeletion(
  schoolId: string,
): Promise<{ error: string } | { success: true; preview: SchoolDeletionPreview }> {
  if (!isUuid(schoolId)) return { error: "Invalid school." };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("school_deletion_preview", { p_school_id: schoolId });
  if (error) return { error: error.message };
  return { success: true, preview: data as SchoolDeletionPreview };
}

export interface SchoolDeletionSummary {
  schoolName: string;
  rowsDeleted: number;
  studentsDeleted: number;
  staffDeleted: number;
  filesRemoved: number;
  accountsRemoved: number;
  /** Things the database could not do and an operator should finish by hand. Empty when all went well. */
  warnings: string[];
}

export async function deleteSchoolPermanently(input: {
  schoolId: string;
  confirmSlug: string;
  reason: string;
  eraseBilling: boolean;
}): Promise<{ error: string } | { success: true; summary: SchoolDeletionSummary }> {
  const confirmSlug = (input.confirmSlug ?? "").trim();
  const reason = (input.reason ?? "").trim();
  if (!isUuid(input.schoolId)) return { error: "Invalid school." };
  if (!confirmSlug) return { error: "Type the school's slug to confirm." };
  if (reason.length < 3) return { error: "Give a short reason for deleting this school." };

  // The console is one shared login; for an irreversible action we insist on knowing which person.
  const operator = await getAdminOperator();
  if (!operator) return { error: "Choose who you are (the name picker) before deleting a school." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("delete_school_permanently", {
    p_school_id: input.schoolId,
    p_confirm_slug: confirmSlug,
    p_reason: reason,
    p_erase_paid_billing: input.eraseBilling === true,
    p_operator: operator,
  });
  if (error) return { error: error.message };

  // From here the school is gone; nothing below may turn that into an error for the caller.
  const snap = (data ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  const warnings: string[] = [];
  let filesRemoved = 0;
  let accountsRemoved = 0;

  try {
    const admin = createAdminClient() as unknown as PurgeClient;
    const files = await removeSchoolFiles(admin, input.schoolId);
    filesRemoved = files.filesRemoved;
    for (const f of files.failures) warnings.push(`Files not fully removed (${f})`);

    const accounts = await removeLoginAccounts(admin, snap.auth_user_ids_to_remove);
    accountsRemoved = accounts.removed;
    for (const f of accounts.failures) warnings.push(`Login account not removed (${f})`);
  } catch (e) {
    warnings.push(
      `The school's files and login accounts were NOT removed: ${e instanceof Error ? e.message : "unknown error"}`,
    );
  }

  // The database function already wrote the main activity-log row atomically with the deletion.
  // This second row records what happened to the parts SQL cannot touch, so a half-finished cleanup is visible.
  await logAdminAction(supabase, "delete_school_permanently_cleanup", {
    school_id: input.schoolId,
    school_name: snap.school_name ?? null,
    files_removed: filesRemoved,
    login_accounts_removed: accountsRemoved,
    warnings,
  });

  revalidatePath("/admin");
  revalidatePath("/admin/billing");
  revalidatePath("/admin/activity-log");

  return {
    success: true,
    summary: {
      schoolName: String(snap.school_name ?? ""),
      rowsDeleted: num(snap.rows_deleted_total),
      studentsDeleted: num(snap.students_deleted),
      staffDeleted: num(snap.staff_deleted),
      filesRemoved,
      accountsRemoved,
      warnings,
    },
  };
}
