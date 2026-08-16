"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { findOrCreateGuardian } from "@/lib/guardians";

export async function previewNextAdmissionNumber(): Promise<{ error: string } | { admissionNumber: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("next_admission_number");
  if (error || !data) return { error: error?.message ?? "Could not compute the next admission number." };
  return { admissionNumber: data as string };
}

export interface CreateStudentInput {
  // Auto-assigned server-side (see the students_before_insert trigger) — always send blank
  // so the DB computes it atomically at insert time; never trust a client-held preview value.
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
): Promise<{ error: string } | { success: true; studentId: string; admissionNumber: string }> {
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
    .select("id, admission_number")
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

  // Registration creates an application (status defaults to 'applied') — advancing
  // it through approved -> enrolled -> active is the Admissions review flow's job,
  // not this form's. See /admissions.
  revalidatePath("/students");
  revalidatePath("/admissions");
  return { success: true as const, studentId: student.id as string, admissionNumber: student.admission_number as string };
}
