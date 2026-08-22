"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

export async function submitAttendance(input: {
  stream_id: string;
  attendance_date: string;
  marks: { student_id: string; status: "present" | "absent" | "late" }[];
}): Promise<ActionResult> {
  const supabase = await createClient();

  const { data: schoolId, error: schoolIdError } = await supabase.rpc("auth_school_id");
  if (schoolIdError || !schoolId) return { error: "Could not resolve your school." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("school_users")
    .select("id")
    .eq("auth_user_id", user!.id)
    .single();

  const rows = input.marks.map((m) => ({
    school_id: schoolId,
    student_id: m.student_id,
    stream_id: input.stream_id,
    attendance_date: input.attendance_date,
    status: m.status,
    marked_by: me?.id ?? null,
  }));

  // First-time marking only — the unique(stream_id, student_id, attendance_date, session)
  // constraint stops this from silently overwriting an already-marked day. This route
  // always writes session='class' (the column default); Boarding roll call writes
  // session='boarding_am'/'boarding_pm' via its own action, so the two never collide.
  // Corrections go through editAttendanceRecord, which requires a reason.
  const { error } = await supabase.from("student_attendance").insert(rows);
  if (error) return { error: error.message };

  revalidatePath("/attendance");
  return { success: true };
}

export async function editAttendanceRecord(
  id: string,
  status: "present" | "absent" | "late",
  edit_reason: string,
): Promise<ActionResult> {
  if (!edit_reason.trim()) return { error: "A reason is required to edit an already-marked day." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("school_users").select("id").eq("auth_user_id", user?.id ?? "").maybeSingle();

  const { data: current, error: currentError } = await supabase
    .from("student_attendance")
    .select("status")
    .eq("id", id)
    .single();
  if (currentError || !current) return { error: "Could not find that attendance record." };

  // The correction itself takes effect immediately (unchanged behaviour) --
  // but is now also flagged for after-the-fact review by an authority
  // (attendance.approve_correction), giving oversight over every retroactive
  // change to attendance history without blocking the class teacher's
  // day-to-day ability to fix a mistake. previous_status preserves what the
  // record said before this edit, so a later Reject can actually restore it
  // instead of just leaving the disputed value in place with a label.
  const { data: updated, error } = await supabase
    .from("student_attendance")
    .update({
      status,
      edit_reason,
      correction_status: "pending",
      requested_status: status,
      correction_reason: edit_reason,
      requested_by: me?.id ?? null,
      previous_status: current.status,
    })
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) {
    return { error: "You don't have permission to edit this record." };
  }
  revalidatePath("/attendance");

  // Best-effort: let everyone who can review corrections know one is pending. Never block on this.
  const { data: requesterName } = me?.id
    ? await supabase.from("school_users").select("full_name").eq("id", me.id).maybeSingle()
    : { data: null };
  await supabase.rpc("notify_users_with_permission", {
    p_permission_key: "attendance.approve_correction",
    p_subject: "Attendance correction needs review",
    p_body: `${requesterName?.full_name ?? "Someone"} corrected an attendance record to "${status}": ${edit_reason}`,
    p_action_url: "/attendance",
    p_category: "other",
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// After-the-fact review of a correction already applied via editAttendanceRecord.
// ---------------------------------------------------------------------------
export async function reviewAttendanceCorrection(id: string, decision: "approved" | "rejected"): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("school_users").select("id").eq("auth_user_id", user?.id ?? "").maybeSingle();

  const { data: record } = await supabase.from("student_attendance").select("requested_by").eq("id", id).maybeSingle();

  const update: Record<string, unknown> = {
    correction_status: decision,
    reviewed_by: me?.id ?? null,
    reviewed_at: new Date().toISOString(),
    previous_status: null,
  };
  if (decision === "rejected") {
    // Restore what the record said before the disputed correction was applied.
    const { data: previous } = await supabase
      .from("student_attendance")
      .select("previous_status")
      .eq("id", id)
      .single();
    if (previous?.previous_status) {
      update.status = previous.previous_status;
    }
  }

  // .select() on the update is required here, not cosmetic: RLS blocks an
  // unauthorized UPDATE by matching zero rows, not by raising an error --
  // a class teacher (approve_correction without mark_any) trying to review
  // a correction outside their own stream would otherwise get {error: null}
  // back and the caller would report success even though nothing changed.
  const { data: updated, error } = await supabase
    .from("student_attendance")
    .update(update)
    .eq("id", id)
    .eq("correction_status", "pending")
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) {
    return { error: "You don't have permission to review this correction, or it was already reviewed." };
  }
  revalidatePath("/attendance");

  // Best-effort: tell whoever requested the correction the outcome. Never block on this.
  if (record?.requested_by) {
    await supabase.rpc("notify_school_user", {
      p_recipient_id: record.requested_by,
      p_subject: decision === "approved" ? "Attendance correction approved" : "Attendance correction rejected",
      p_body:
        decision === "approved"
          ? "Your attendance correction was approved."
          : "Your attendance correction was rejected and the original record was restored.",
      p_action_url: "/attendance",
      p_category: "other",
    });
  }

  return { success: true };
}
