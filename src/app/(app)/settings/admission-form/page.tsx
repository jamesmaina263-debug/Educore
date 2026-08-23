import { loadSettingsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { AdmissionFormTemplatePanel } from "@/components/settings/admission-form-template-panel";
import { getAdmissionFormTemplate } from "./actions";

export default async function SettingsAdmissionFormPage() {
  const ctx = await loadSettingsContext();
  const template = await getAdmissionFormTemplate();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Settings"
      moduleHref="/settings/general"
      section="Admission Form"
      title="Settings"
    >
      <AdmissionFormTemplatePanel initial={template} canWrite={ctx.canWriteBranding} />
    </ModulePageShell>
  );
}
