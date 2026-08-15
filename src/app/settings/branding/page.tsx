import { loadSettingsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { BrandingForm } from "@/components/settings/branding-form";

export default async function SettingsBrandingPage() {
  const ctx = await loadSettingsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Settings"
      moduleHref="/settings/general"
      section="Branding"
      title="Settings"
    >
      <BrandingForm initial={ctx.brandingData} canWrite={ctx.canWriteBranding} groupFallback={ctx.groupBranding} />
    </ModulePageShell>
  );
}
