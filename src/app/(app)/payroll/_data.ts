import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { PayrollRow, StaffOption, SalaryStructureRow } from "@/components/payroll/payroll-section";

// Shape returned by the get_staff_statutory_numbers() RPC -- see
// 20260820214843_close_staff_statutory_numbers_read_leak.sql. Typed by hand rather than via
// generated Supabase types, which this codebase doesn't use for RPCs (every other .rpc() call
// here is scalar).
interface StatutoryNumbersRow {
  staff_id: string;
  staff_number: string | null;
  kra_pin: string | null;
  nssf_number: string | null;
  shif_number: string | null;
}

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
      "id, teacher_id, period_year, period_month, gross_salary, nssf_employee, shif, ahl, taxable_income, paye, other_deductions, allowances_breakdown, deductions_breakdown, net_pay, status, school_users!payroll_records_teacher_id_fkey(full_name)",
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
    const employee = r.school_users as unknown as { full_name: string } | null;
    return {
      id: r.id,
      teacher_id: r.teacher_id,
      staff_name: employee?.full_name ?? "Unknown",
      staff_number: null,
      staff_kra_pin: null,
      staff_nssf_number: null,
      staff_shif_number: null,
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

  // Statutory numbers (kra_pin/nssf_number/shif_number/staff_number) are no longer readable via
  // an embedded school_users(...) join -- SELECT on those 4 columns was revoked at the database
  // level (see 20260820214843_close_staff_statutory_numbers_read_leak.sql). The only sanctioned
  // read path is this RPC, which enforces "self, or payroll.read_any" itself server-side --
  // called unconditionally here (not gated on the canReadAny UI flag) so a staff member with
  // neither read_any nor write, viewing only their own payslip via payroll_records' own
  // self-row RLS branch, still gets their own numbers back; the RPC silently omits any other
  // staff_id they're not entitled to rather than erroring.
  if (recordRows && recordRows.length > 0) {
    const { data: statutoryRows } = await supabase.rpc("get_staff_statutory_numbers", {
      p_staff_ids: Array.from(new Set(recordRows.map((r) => r.teacher_id))),
    });
    const statutory = (statutoryRows ?? []) as unknown as StatutoryNumbersRow[];
    const statutoryByStaffId = new Map(statutory.map((s) => [s.staff_id, s]));
    for (const r of records) {
      const statutory = statutoryByStaffId.get(r.teacher_id);
      if (statutory) {
        r.staff_number = statutory.staff_number;
        r.staff_kra_pin = statutory.kra_pin;
        r.staff_nssf_number = statutory.nssf_number;
        r.staff_shif_number = statutory.shif_number;
      }
    }
  }

  let structures: SalaryStructureRow[] = [];
  if (canReadAny) {
    const { data: structureRows } = await supabase
      .from("staff_salary_structures")
      .select(
        "id, staff_id, basic_salary, effective_from, school_users!staff_salary_structures_staff_id_fkey(full_name), salary_structure_allowances(id, name, amount), salary_structure_deductions(id, name, amount)",
      )
      .eq("active", true)
      .order("effective_from", { ascending: false });

    const { data: statutoryRows } = await supabase.rpc("get_staff_statutory_numbers", {
      p_staff_ids: Array.from(new Set((structureRows ?? []).map((s) => s.staff_id))),
    });
    const statutory = (statutoryRows ?? []) as unknown as StatutoryNumbersRow[];
    const statutoryByStaffId = new Map(statutory.map((s) => [s.staff_id, s]));

    structures = (structureRows ?? []).map((s) => {
      const employee = s.school_users as unknown as { full_name: string } | null;
      const statutory = statutoryByStaffId.get(s.staff_id);
      return {
        id: s.id,
        staff_id: s.staff_id,
        staff_name: employee?.full_name ?? "Unknown",
        staff_number: statutory?.staff_number ?? null,
        staff_kra_pin: statutory?.kra_pin ?? null,
        staff_nssf_number: statutory?.nssf_number ?? null,
        staff_shif_number: statutory?.shif_number ?? null,
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
