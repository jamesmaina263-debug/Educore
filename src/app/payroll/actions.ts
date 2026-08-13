"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

export async function generatePayrollAction(input: {
  teacher_id: string;
  period_year: number;
  period_month: number;
  gross_salary: number;
  other_deductions?: number;
  other_deductions_note?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("generate_payroll_record", {
    p_teacher_id: input.teacher_id,
    p_period_year: input.period_year,
    p_period_month: input.period_month,
    p_gross_salary: input.gross_salary,
    p_other_deductions: input.other_deductions ?? 0,
    p_other_deductions_note: input.other_deductions_note ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath("/payroll");
  return { success: true };
}

export async function approvePayrollAction(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_payroll_record", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/payroll");
  return { success: true };
}

export async function markPayrollPaidAction(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_payroll_paid", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/payroll");
  return { success: true };
}

async function currentSchoolUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, schoolUser: null };
  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("id, school_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return { supabase, schoolUser };
}

// ---------------------------------------------------------------------------
// Salary Structures — basic + recurring allowances/deductions that feed into
// generate_payroll_record() as better-computed defaults. The statutory
// calculation itself stays entirely inside that existing RPC, untouched.
// ---------------------------------------------------------------------------
export async function saveSalaryStructureAction(input: {
  staff_id: string;
  basic_salary: number;
  allowances: { name: string; amount: number }[];
  deductions: { name: string; amount: number }[];
}): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  // Deactivate any existing active structure for this staff member, then
  // create a fresh one -- keeps history (old structures aren't deleted,
  // just no longer active) rather than editing in place.
  await supabase
    .from("staff_salary_structures")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("staff_id", input.staff_id)
    .eq("active", true);

  const { data: structure, error } = await supabase
    .from("staff_salary_structures")
    .insert({ school_id: schoolUser.school_id, staff_id: input.staff_id, basic_salary: input.basic_salary })
    .select("id")
    .single();
  if (error) return { error: error.message };

  if (structure) {
    if (input.allowances.length > 0) {
      await supabase.from("salary_structure_allowances").insert(
        input.allowances.map((a) => ({ structure_id: structure.id, school_id: schoolUser.school_id, name: a.name, amount: a.amount })),
      );
    }
    if (input.deductions.length > 0) {
      await supabase.from("salary_structure_deductions").insert(
        input.deductions.map((d) => ({ structure_id: structure.id, school_id: schoolUser.school_id, name: d.name, amount: d.amount })),
      );
    }
  }

  revalidatePath("/payroll");
  return { success: true };
}
