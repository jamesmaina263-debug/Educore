"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

async function transition(studentId: string, status: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("students").update({ status }).eq("id", studentId);
  if (error) return { error: error.message };
  revalidatePath("/admissions");
  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  return { success: true };
}

export async function approveApplication(studentId: string): Promise<ActionResult> {
  return transition(studentId, "approved");
}

export async function enrollApplication(studentId: string, streamId: string): Promise<ActionResult> {
  const supabase = await createClient();
  // Assign the class/stream first, then transition — the trigger doesn't require
  // current_class_id to be set, but a student with nowhere to sit isn't really
  // "enrolled" in any useful sense, so we do both together.
  const { error: assignError } = await supabase
    .from("students")
    .update({ current_class_id: streamId })
    .eq("id", studentId);
  if (assignError) return { error: assignError.message };
  return transition(studentId, "enrolled");
}

export async function activateEnrollment(studentId: string): Promise<ActionResult> {
  return transition(studentId, "active");
}

export async function rejectApplication(studentId: string): Promise<ActionResult> {
  return transition(studentId, "withdrawn");
}
