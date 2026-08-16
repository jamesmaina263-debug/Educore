import { loadBoardingContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { ReportsSection } from "@/components/boarding/reports-section";

export default async function BoardingReportsPage() {
  const ctx = await loadBoardingContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Boarding"
      moduleHref="/boarding/dashboard"
      section="Reports"
      title="Reports"
    >
      <ReportsSection data={ctx.reportsData} schoolName={ctx.schoolName} />
    </ModulePageShell>
  );
}
