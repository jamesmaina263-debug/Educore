import { loadIntegrationsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { NemisPanel } from "@/components/integrations/nemis-panel";

export default async function IntegrationsNemisPage() {
  const ctx = await loadIntegrationsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Integrations"
      moduleHref="/integrations/nemis"
      section="NEMIS"
      title="NEMIS"
      subtitle="Kenya's NEMIS/KEMIS has no public API for schools to submit to directly — generate a Ministry-format bulk-upload file here, upload it in the NEMIS portal yourself, then confirm it below."
      noAccess={!ctx.canManageNemis}
    >
      <NemisPanel
        schoolName={ctx.schoolName}
        institutionCode={ctx.nemisInstitutionCode}
        pendingStudents={ctx.pendingStudents}
        includedStudents={ctx.includedStudents}
        batches={ctx.batches}
      />
    </ModulePageShell>
  );
}
