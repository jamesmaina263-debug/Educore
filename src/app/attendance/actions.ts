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

  // First-time marking only — the unique(stream_id, student_id, attendance_date)
  // constraint stops this from silently overwriting an already-marked day.
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
  const { error } = await supabase.from("student_attendance").update({ status, edit_reason }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/attendance");
  return { success: true };
}
