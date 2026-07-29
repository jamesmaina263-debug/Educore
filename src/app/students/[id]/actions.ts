"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { findOrCreateGuardian } from "@/lib/guardians";

export async function addGuardian(
  studentId: string,
  input: {
    phone: string;
    full_name: string;
    email?: string;
    relationship: "mother" | "father" | "guardian" | "other";
    primary_contact: boolean;
  },
): Promise<{ error: string } | { success: true }> {
  const supabase = await createClient();

  const guardian = await findOrCreateGuardian(supabase, {
    phone: input.phone,
    full_name: input.full_name,
    email: input.email,
  });
  if ("error" in guardian) return { error: guardian.error };

  if (input.primary_contact) {
    // Only one primary contact per student — demote any existing one
    // rather than ending up with two (SMS should go to exactly one
    // default recipient, per §D).
    await supabase
      .from("student_guardians")
      .update({ primary_contact: false })
      .eq("student_id", studentId)
      .eq("primary_contact", true);
  }

  const { error } = await supabase.from("student_guardians").insert({
    student_id: studentId,
    guardian_user_id: guardian.id,
    relationship: input.relationship,
    primary_contact: input.primary_contact,
  });
  if (error) return { error: error.message };

  revalidatePath(`/students/${studentId}`);
  return { success: true as const };
}
