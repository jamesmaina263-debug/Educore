import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { PayrollRow, StaffOption, SalaryStructureRow } from "@/components/payroll/payroll-section";

export interface PayrollContext {
  userName: string;
  userRole?: string;
  schoolName: string;
  canReadAny: boolean;
  canWrite: boolean;
  canApprove: boolean;
  employerKraPin: string | null;
  records: PayrollRow[];
  staffOptions: StaffOption[];
  structures: SalaryStructureRow[];
}

export async function loadPayrollContext(): Promise<PayrollContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canReadAny }, { data: canWrite }, { data: canApprove }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name, kra_pin)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "payroll.read_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "payroll.write" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "payroll.approve" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const school = schoolUser?.schools as unknown as { name: string; kra_pin: string | null } | null;
  const schoolName = school?.name ?? "EduCore";

  const { data: recordRows } = await supabase
    .from("payroll_records")
    .select(
      "id, teacher_id, period_year, period_month, gross_salary, nssf_employee, shif, ahl, taxable_income, paye, other_deductions, allowances_breakdown, deductions_breakdown, net_pay, status, school_users!payroll_records_teacher_id_fkey(full_name, staff_number, kra_pin, nssf_number, shif_number)",
    )
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false });

  let staffOptions: StaffOption[] = [];
  if (canWrite) {
    const { data: staff } = await supabase
      .from("school_users")
      .select("id, full_name, roles!inner(name)")
      .eq("status", "active")
      .not("roles.name", "in", "(parent,student,super_admin)");
    staffOptions = (staff ?? []).map((s) => ({ id: s.id, full_name: s.full_name }));
  }

  const records: PayrollRow[] = (recordRows ?? []).map((r) => {
    const employee = r.school_users as unknown as {
      full_name: string;
      staff_number: string | null;
      kra_pin: string | null;
      nssf_number: string | null;
      shif_number: string | null;
    } | null;
    return {
      id: r.id,
      teacher_id: r.teacher_id,
      staff_name: employee?.full_name ?? "Unknown",
      staff_number: employee?.staff_number ?? null,
      staff_kra_pin: employee?.kra_pin ?? null,
      staff_nssf_number: employee?.nssf_number ?? null,
      staff_shif_number: employee?.shif_number ?? null,
      period_year: r.period_year,
      period_month: r.period_month,
      gross_salary: Number(r.gross_salary),
      nssf_employee: Number(r.nssf_employee),
      shif: Number(r.shif),
      ahl: Number(r.ahl),
      taxable_income: Number(r.taxable_income),
      paye: Number(r.paye),
      other_deductions: Number(r.other_deductions),
      allowances_breakdown: (r.allowances_breakdown as { name: string; amount: number }[] | null) ?? [],
      deductions_breakdown: (r.deductions_breakdown as { name: string; amount: number }[] | null) ?? [],
      net_pay: Number(r.net_pay),
      status: r.status as "draft" | "approved" | "paid",
    };
  });

  let structures: SalaryStructureRow[] = [];
  if (canReadAny) {
    const { data: structureRows } = await supabase
      .from("staff_salary_structures")
      .select(
        "id, staff_id, basic_salary, effective_from, school_users!staff_salary_structures_staff_id_fkey(full_name, staff_number, kra_pin, nssf_number, shif_number), salary_structure_allowances(id, name, amount), salary_structure_deductions(id, name, amount)",
      )
      .eq("active", true)
      .order("effective_from", { ascending: false });

    structures = (structureRows ?? []).map((s) => {
      const employee = s.school_users as unknown as {
        full_name: string;
        staff_number: string | null;
        kra_pin: string | null;
        nssf_number: string | null;
        shif_number: string | null;
      } | null;
      return {
        id: s.id,
        staff_id: s.staff_id,
        staff_name: employee?.full_name ?? "Unknown",
        staff_number: employee?.staff_number ?? null,
        staff_kra_pin: employee?.kra_pin ?? null,
        staff_nssf_number: employee?.nssf_number ?? null,
        staff_shif_number: employee?.shif_number ?? null,
        basic_salary: Number(s.basic_salary),
        effective_from: s.effective_from,
        allowances: (s.salary_structure_allowances as unknown as { id: string; name: string; amount: number }[]) ?? [],
        deductions: (s.salary_structure_deductions as unknown as { id: string; name: string; amount: number }[]) ?? [],
      };
    });
  }

  return {
    userName: schoolUser?.full_name ?? user.email ?? "Account",
    userRole: roleName,
    schoolName,
    canReadAny: canReadAny === true,
    canWrite: canWrite === true,
    canApprove: canApprove === true,
    employerKraPin: school?.kra_pin ?? null,
    records,
    staffOptions,
    structures,
  };
}
