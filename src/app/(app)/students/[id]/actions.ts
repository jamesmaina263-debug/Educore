"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { findOrCreateGuardian } from "@/lib/guardians";

export interface GuardianSearchResult {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  linked_student_count: number;
}

export async function searchGuardians(query: string): Promise<GuardianSearchResult[] | { error: string }> {
  if (query.trim().length < 2) return [];
  const supabase = await createClient();

  const { data: parentRole } = await supabase.from("roles").select("id").eq("name", "parent").single();
  if (!parentRole) return { error: "Could not resolve the parent role." };

  const { data: matches, error } = await supabase
    .from("school_users")
    .select("id, full_name, phone, email")
    .eq("role_id", parentRole.id)
    .or(`full_name.ilike.%${query}%,phone.ilike.%${query}%`)
    .limit(8);
  if (error) return { error: error.message };
  if (!matches || matches.length === 0) return [];

  const { data: links } = await supabase
    .from("student_guardians")
    .select("guardian_user_id")
    .in(
      "guardian_user_id",
      matches.map((m) => m.id),
    );
  const countByGuardian = new Map<string, number>();
  for (const l of links ?? []) {
    countByGuardian.set(l.guardian_user_id, (countByGuardian.get(l.guardian_user_id) ?? 0) + 1);
  }

  return matches.map((m) => ({
    id: m.id,
    full_name: m.full_name,
    phone: m.phone,
    email: m.email,
    linked_student_count: countByGuardian.get(m.id) ?? 0,
  }));
}

async function linkGuardian(
  studentId: string,
  guardianId: string,
  relationship: "mother" | "father" | "guardian" | "other",
  primaryContact: boolean,
): Promise<{ error: string } | { success: true }> {
  const supabase = await createClient();

  if (primaryContact) {
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
    guardian_user_id: guardianId,
    relationship,
    primary_contact: primaryContact,
  });
  if (error) return { error: error.message };

  revalidatePath(`/students/${studentId}`);
  return { success: true as const };
}

export async function linkExistingGuardian(
  studentId: string,
  guardianId: string,
  relationship: "mother" | "father" | "guardian" | "other",
  primaryContact: boolean,
): Promise<{ error: string } | { success: true }> {
  return linkGuardian(studentId, guardianId, relationship, primaryContact);
}

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

  return linkGuardian(studentId, guardian.id, input.relationship, input.primary_contact);
}
