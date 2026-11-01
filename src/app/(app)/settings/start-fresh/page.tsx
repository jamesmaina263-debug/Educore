import { loadSettingsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { StartFreshPanel } from "@/components/settings/start-fresh-panel";
import { getTrialResetPreview } from "../trial-reset-actions";

export default async function SettingsStartFreshPage() {
  const ctx = await loadSettingsContext();
  // Eligibility (school owner + still on a free trial) is decided by the server, not by this page.
  const preview = await getTrialResetPreview();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Settings"
      moduleHref="/settings/general"
      section="Start Fresh"
      title="Settings"
      subtitle="Remove test data from your free trial"
    >
      <StartFreshPanel preview={preview} />
    </ModulePageShell>
  );
}
