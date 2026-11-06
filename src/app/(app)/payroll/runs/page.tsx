import Link from "next/link";
import { loadPayrollContext } from "../_data";
import { createClient } from "@/lib/supabase/server";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { getSchoolSlug } from "@/lib/school-slug-server";
import { withSchoolSlug } from "@/lib/school-slug-href";
import { STAFF_LOANS_FLAG } from "@/lib/staff-loans";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { PayrollSection } from "@/components/payroll/payroll-section";

export default async function PayrollRunsPage() {
  const ctx = await loadPayrollContext();
  // Link appears only for payroll staff in a school with staff loans switched on (fails closed).
  const showLoans = ctx.canReadAny && (await hasFeatureFlag(await createClient(), STAFF_LOANS_FLAG));
  const schoolSlug = showLoans ? await getSchoolSlug() : undefined;
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Payroll"
      moduleHref="/payroll/runs"
      section="Payroll Runs"
      title="Payroll"
      subtitle={
        ctx.canReadAny
          ? "Salary structures and monthly payslips across your staff — NSSF, SHIF, Housing Levy and PAYE computed against current Kenyan statutory rates."
          : "Your payslips — visible to you and school leadership only."
      }
    >
      {showLoans && (
        <p className="mb-3 text-sm">
          <Link className="text-primary hover:underline" href={withSchoolSlug(schoolSlug, "/payroll/loans")}>
            Staff loans and advances
          </Link>
        </p>
      )}
      <PayrollSection
        section="runs"
        records={ctx.records}
        staffOptions={ctx.staffOptions}
        structures={ctx.structures}
        schoolName={ctx.schoolName}
        employerKraPin={ctx.employerKraPin}
        canGenerate={ctx.canWrite}
        canApprove={ctx.canApprove}
        canMarkPaid={ctx.canWrite}
        canManageStructures={ctx.canWrite}
      />
    </ModulePageShell>
  );
}
