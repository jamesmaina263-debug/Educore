"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { buildEmploymentUpdate, type EmploymentInput } from "@/lib/staff/employment-input";

export async function updateEmployment(
  staffId: string,
  input: EmploymentInput,
): Promise<{ error: string } | { success: true }> {
  const built = buildEmploymentUpdate(input);
  if ("error" in built) return { error: built.error };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  // .select() so a blocked update (zero matched rows, which RLS reports as success) isn't shown as
  // saved. Safe with respect to SELECT/UPDATE alignment: school_users UPDATE needs self / staff.manage
  // in the same school, and the SELECT policy is school-wide, so anything updatable is also returnable.
  const { data: updated, error } = await supabase.from("school_users").update(built.payload).eq("id", staffId).select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) return { error: "Could not update this staff member -- you may not have permission." };
  revalidatePath(`/staff/${staffId}`);
  return { success: true as const };
}

export async function addQualification(
  staffId: string,
  input: { qualification_name: string; institution?: string; year_obtained?: number; expiry_date?: string },
): Promise<{ error: string } | { success: true }> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data: schoolId, error: schoolIdError } = await supabase.rpc("auth_school_id");
  if (schoolIdError || !schoolId) return { error: "Could not resolve your school." };

  const { error } = await supabase.from("staff_qualifications").insert({
    school_id: schoolId,
    staff_id: staffId,
    qualification_name: input.qualification_name,
    institution: input.institution || null,
    year_obtained: input.year_obtained || null,
    expiry_date: input.expiry_date || null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/staff/${staffId}`);
  return { success: true as const };
}

function daysBetweenInclusive(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diff = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  return diff + 1;
}

export async function requestLeave(
  staffId: string,
  input: { leave_type_id: string; start_date: string; end_date: string; reason?: string },
): Promise<{ error: string } | { success: true }> {
  if (input.end_date < input.start_date) {
    return { error: "End date must be on or after the start date." };
  }
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data: schoolId, error: schoolIdError } = await supabase.rpc("auth_school_id");
  if (schoolIdError || !schoolId) return { error: "Could not resolve your school." };

  const { data: requester } = await supabase
    .from("school_users")
    .select("full_name")
    .eq("id", staffId)
    .maybeSingle();

  const { error } = await supabase.from("leave_requests").insert({
    school_id: schoolId,
    staff_id: staffId,
    leave_type_id: input.leave_type_id,
    start_date: input.start_date,
    end_date: input.end_date,
    days_count: daysBetweenInclusive(input.start_date, input.end_date),
    reason: input.reason || null,
  });
  if (error) return { error: error.message };

  // Best-effort: let everyone who can approve leave know a request is waiting on them.
  // Never block the request itself on this — a notification failure shouldn't stop
  // someone from submitting their leave request.
  await supabase.rpc("notify_users_with_permission", {
    p_permission_key: "staff.leave.approve",
    p_subject: "Leave request needs approval",
    p_body: `${requester?.full_name ?? "A staff member"} requested ${input.start_date} to ${input.end_date}.`,
    p_action_url: `/staff/${staffId}?tab=leave`,
    p_category: "other",
  });

  revalidatePath(`/staff/${staffId}`);
  return { success: true as const };
}

export async function respondToLeaveRequest(
  requestId: string,
  staffId: string,
  status: "approved" | "rejected",
): Promise<{ error: string } | { success: true }> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: me } = await supabase
    .from("school_users")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  // .select() on the update is required, not cosmetic: RLS blocks an unauthorized UPDATE
  // by matching zero rows, not by raising an error -- without this, someone lacking
  // staff.leave.approve would get {error: null} back and the caller would report success
  // even though the request was never touched. Same pattern as
  // attendance/actions.ts's reviewAttendanceCorrection.
  const { data: updated, error } = await supabase
    .from("leave_requests")
    .update({ status, approved_by: me?.id ?? null, approved_at: new Date().toISOString() })
    .eq("id", requestId)
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) {
    return { error: "You don't have permission to respond to this leave request." };
  }

  // Best-effort: tell the requester the outcome. Never block the approval on this.
  await supabase.rpc("notify_school_user", {
    p_recipient_id: staffId,
    p_subject: status === "approved" ? "Leave request approved" : "Leave request rejected",
    p_body:
      status === "approved"
        ? "Your leave request has been approved."
        : "Your leave request was not approved.",
    p_action_url: `/staff/${staffId}?tab=leave`,
    p_category: "other",
  });

  revalidatePath(`/staff/${staffId}`);
  return { success: true as const };
}

export async function cancelLeaveRequest(
  requestId: string,
  staffId: string,
): Promise<{ error: string } | { success: true }> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  // Same RLS-silent-no-op guard as respondToLeaveRequest above: leave_requests_update's
  // own-request clause only allows this while status = 'pending', so a stale page (the
  // request got approved/rejected/cancelled elsewhere since it was loaded) would otherwise
  // silently report success while leaving the request untouched.
  const { data: updated, error } = await supabase
    .from("leave_requests")
    .update({ status: "cancelled" })
    .eq("id", requestId)
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) {
    return { error: "This request can no longer be cancelled -- it may have already been responded to." };
  }
  revalidatePath(`/staff/${staffId}`);
  return { success: true as const };
}
