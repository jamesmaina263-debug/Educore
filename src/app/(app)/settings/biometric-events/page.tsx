import { loadSettingsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { BiometricEventLogPanel } from "@/components/settings/biometric-event-log-panel";

export default async function SettingsBiometricEventsPage() {
  const ctx = await loadSettingsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Settings"
      moduleHref="/settings/general"
      section="Biometric Events"
      title="Settings"
      noAccess={!ctx.canReadBiometricEvents}
    >
      <BiometricEventLogPanel />
    </ModulePageShell>
  );
}
