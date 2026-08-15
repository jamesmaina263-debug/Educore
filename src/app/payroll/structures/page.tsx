import { loadPayrollContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { PayrollSection } from "@/components/payroll/payroll-section";

export default async function PayrollStructuresPage() {
  const ctx = await loadPayrollContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Payroll"
      moduleHref="/payroll/runs"
      section="Salary Structures"
      title="Payroll"
      noAccess={!ctx.canReadAny}
    >
      <PayrollSection
        section="structures"
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
