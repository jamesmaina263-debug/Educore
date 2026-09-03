import { loadKnecContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { KnecPanel } from "@/components/integrations/knec-panel";

export default async function IntegrationsKnecPage() {
  const ctx = await loadKnecContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Integrations"
      moduleHref="/integrations/knec"
      section="KNEC CBA"
      title="KNEC CBA"
      subtitle="KNEC's CBA portal (cba.knec.ac.ke) has no public API and no published upload template — generate a provisional export here from your competency marks, upload it in the portal yourself, then confirm it below. Column layout will be adjusted once a real KNEC template is available."
      noAccess={!ctx.canManageKnec}
    >
      <KnecPanel
        schoolName={ctx.schoolName}
        knecSchoolCode={ctx.knecSchoolCode}
        exams={ctx.exams}
        pendingEntries={ctx.pendingEntries}
        batches={ctx.batches}
      />
    </ModulePageShell>
  );
}
