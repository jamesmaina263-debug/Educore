import { loadHealthContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { ReportsSection } from "@/components/health/reports-section";

export default async function HealthReportsPage() {
  const ctx = await loadHealthContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Health"
      moduleHref="/health/dashboard"
      section="Reports"
      title="Reports"
      noAccess={!(ctx.canReadAny || ctx.canWrite)}
    >
      <ReportsSection data={ctx.reportsData} schoolName={ctx.schoolName} />
    </ModulePageShell>
  );
}
