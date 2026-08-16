import { loadHealthContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { SickBaySection } from "@/components/health/sick-bay-section";

export default async function HealthSickBayPage() {
  const ctx = await loadHealthContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Health"
      moduleHref="/health/dashboard"
      section="Sick Bay"
      title="Sick Bay"
      noAccess={!ctx.canReadAny}
    >
      <SickBaySection visits={ctx.sickBayTableRows} studentOptions={ctx.studentOptions} canWrite={ctx.canWrite} />
    </ModulePageShell>
  );
}
