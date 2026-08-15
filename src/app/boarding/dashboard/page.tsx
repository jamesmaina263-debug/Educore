import { loadBoardingContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { DashboardSection } from "@/components/boarding/dashboard-section";

export default async function BoardingDashboardPage() {
  const ctx = await loadBoardingContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Boarding"
      moduleHref="/boarding/dashboard"
      section="Dashboard"
      title="Boarding"
      subtitle={ctx.canReadAny ? "Houses, dormitories, rooms, beds, and boarding operations." : "Your child's boarding allocation."}
    >
      <DashboardSection stats={ctx.dashboardStats} />
    </ModulePageShell>
  );
}
