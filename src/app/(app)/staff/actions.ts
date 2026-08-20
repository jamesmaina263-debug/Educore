"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

export async function setStaffGender(staffId: string, gender: "male" | "female"): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("school_users").update({ gender }).eq("id", staffId);
  if (error) return { error: error.message };
  revalidatePath("/staff");
  revalidatePath(`/staff/${staffId}`);
  return { success: true as const };
}

type StaffStatus = "present" | "absent" | "late" | "on_leave" | "half_day";

export async function submitStaffAttendance(input: {
  attendance_date: string;
  marks: { staff_id: string; status: StaffStatus }[];
}): Promise<ActionResult> {
  const supabase = await createClient();

  const { data: schoolId, error: schoolIdError } = await supabase.rpc("auth_school_id");
  if (schoolIdError || !schoolId) return { error: "Could not resolve your school." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("school_users").select("id").eq("auth_user_id", user!.id).single();

  const rows = input.marks.map((m) => ({
    school_id: schoolId,
    staff_id: m.staff_id,
    attendance_date: input.attendance_date,
    status: m.status,
    marked_by: me?.id ?? null,
  }));

  // First-time marking only -- the unique(staff_id, attendance_date)
  // constraint stops this from silently overwriting an already-marked day.
  // Corrections go through editStaffAttendanceRecord, which requires a reason.
  const { error } = await supabase.from("staff_attendance").insert(rows);
  if (error) return { error: error.message };

  revalidatePath("/staff");
  return { success: true };
}

export async function editStaffAttendanceRecord(
  id: string,
  status: StaffStatus,
  edit_reason: string,
): Promise<ActionResult> {
  if (!edit_reason.trim()) return { error: "A reason is required to edit an already-marked day." };
  const supabase = await createClient();
  const { error } = await supabase.from("staff_attendance").update({ status, edit_reason }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/staff");
  return { success: true };
}
