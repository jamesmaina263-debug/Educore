import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { PayrollSection, type PayrollRow, type StaffOption } from "@/components/payroll/payroll-section";

export default async function PayrollPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canReadAny }, { data: canWrite }, { data: canApprove }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "payroll.read_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "payroll.write" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "payroll.approve" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  const { data: recordRows } = await supabase
    .from("payroll_records")
    .select(
      "id, teacher_id, period_year, period_month, gross_salary, nssf_employee, shif, ahl, taxable_income, paye, other_deductions, net_pay, status, school_users!payroll_records_teacher_id_fkey(full_name)",
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

  const records: PayrollRow[] = (recordRows ?? []).map((r) => ({
    id: r.id,
    teacher_id: r.teacher_id,
    staff_name: (r.school_users as unknown as { full_name: string } | null)?.full_name ?? "Unknown",
    period_year: r.period_year,
    period_month: r.period_month,
    gross_salary: Number(r.gross_salary),
    nssf_employee: Number(r.nssf_employee),
    shif: Number(r.shif),
    ahl: Number(r.ahl),
    taxable_income: Number(r.taxable_income),
    paye: Number(r.paye),
    other_deductions: Number(r.other_deductions),
    net_pay: Number(r.net_pay),
    status: r.status as "draft" | "approved" | "paid",
  }));

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Payroll" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Payroll</h1>
          <p className="text-sm text-muted-foreground">
            {canReadAny
              ? "Monthly payslips across your staff — NSSF, SHIF, Housing Levy and PAYE computed against current Kenyan statutory rates."
              : "Your payslips — visible to you and school leadership only."}
          </p>
        </div>

        <PayrollSection
          records={records}
          staffOptions={staffOptions}
          canGenerate={canWrite === true}
          canApprove={canApprove === true}
          canMarkPaid={canWrite === true}
        />
      </div>
    </AppShell>
  );
}
