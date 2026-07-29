"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { findOrCreateGuardian } from "@/lib/guardians";

export interface CreateStudentInput {
  admission_number: string;
  upi_number?: string;
  first_name: string;
  last_name: string;
  other_names?: string;
  date_of_birth: string;
  gender: "male" | "female";
  guardian: {
    phone: string;
    full_name: string;
    email?: string;
    relationship: "mother" | "father" | "guardian" | "other";
  };
}

export async function createStudentWithGuardian(
  input: CreateStudentInput,
): Promise<{ error: string } | { success: true; studentId: string }> {
  const supabase = await createClient();

  const guardian = await findOrCreateGuardian(supabase, {
    phone: input.guardian.phone,
    full_name: input.guardian.full_name,
    email: input.guardian.email,
  });
  if ("error" in guardian) return { error: guardian.error };

  const { data: schoolId, error: schoolIdError } = await supabase.rpc("auth_school_id");
  if (schoolIdError || !schoolId) {
    return { error: "Could not resolve your school." };
  }

  const { data: student, error: studentError } = await supabase
    .from("students")
    .insert({
      school_id: schoolId,
      admission_number: input.admission_number,
      upi_number: input.upi_number || null,
      first_name: input.first_name,
      last_name: input.last_name,
      other_names: input.other_names || null,
      date_of_birth: input.date_of_birth,
      gender: input.gender,
    })
    .select("id")
    .single();

  if (studentError || !student) {
    return { error: studentError?.message ?? "Could not create the student record." };
  }

  const { error: linkError } = await supabase.from("student_guardians").insert({
    student_id: student.id,
    guardian_user_id: guardian.id,
    relationship: input.guardian.relationship,
    primary_contact: true,
  });
  if (linkError) return { error: linkError.message };

  const { error: activateError } = await supabase
    .from("students")
    .update({ status: "active" })
    .eq("id", student.id);
  if (activateError) return { error: activateError.message };

  revalidatePath("/students");
  return { success: true as const, studentId: student.id as string };
}
