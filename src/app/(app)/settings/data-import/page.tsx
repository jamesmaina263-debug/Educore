import { loadSettingsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { DataImportPanel } from "@/components/settings/data-import-panel";

export default async function SettingsDataImportPage() {
  const ctx = await loadSettingsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Settings"
      moduleHref="/settings/general"
      section="Data Import"
      title="Settings"
      subtitle="Migrate a school's data in from another system"
      noAccess={!ctx.canImportData}
    >
      <DataImportPanel canImport={ctx.canImportData} />
    </ModulePageShell>
  );
}
