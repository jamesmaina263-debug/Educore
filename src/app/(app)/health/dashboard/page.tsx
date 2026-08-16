import { loadHealthContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { DashboardSection } from "@/components/health/dashboard-section";

export default async function HealthDashboardPage() {
  const ctx = await loadHealthContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Health"
      moduleHref="/health/dashboard"
      section="Dashboard"
      title="Health"
      subtitle="Clinic, sick bay, medication, and medical records."
      noAccess={!ctx.canReadAny}
    >
      <DashboardSection stats={ctx.dashboardStats} />
    </ModulePageShell>
  );
}
