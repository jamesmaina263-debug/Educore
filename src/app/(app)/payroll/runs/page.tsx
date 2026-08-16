import { loadPayrollContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { PayrollSection } from "@/components/payroll/payroll-section";

export default async function PayrollRunsPage() {
  const ctx = await loadPayrollContext();
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
