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
