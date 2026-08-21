import { loadHealthContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { EmergenciesSection } from "@/components/health/emergencies-section";

export default async function HealthEmergenciesPage() {
  const ctx = await loadHealthContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Health"
      moduleHref="/health/dashboard"
      section="Emergencies"
      title="Emergencies"
      noAccess={!(ctx.canReadAny || ctx.canWrite)}
    >
      <EmergenciesSection emergencies={ctx.emergencyTableRows} studentOptions={ctx.studentOptions} canWrite={ctx.canWrite} />
    </ModulePageShell>
  );
}
