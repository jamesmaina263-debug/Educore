import { loadSettingsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { GeneralSettingsPanel } from "@/components/settings/general-panel";

export default async function SettingsGeneralPage() {
  const ctx = await loadSettingsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Settings"
      moduleHref="/settings/general"
      section="General"
      title="Settings"
      subtitle="Applies to all users in this school"
    >
      <GeneralSettingsPanel initial={ctx.generalData} canWrite={ctx.canWriteBranding} />
    </ModulePageShell>
  );
}
