import { loadSettingsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { DataExportPanel } from "@/components/settings/data-export-panel";

export default async function SettingsDataExportPage() {
  const ctx = await loadSettingsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Settings"
      moduleHref="/settings/general"
      section="Data Export"
      title="Settings"
      subtitle="Download your school's own data"
      noAccess={!ctx.canExportData}
    >
      <DataExportPanel canExport={ctx.canExportData} />
    </ModulePageShell>
  );
}
