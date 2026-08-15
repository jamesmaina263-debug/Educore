import { loadSettingsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { NotificationPreferencesPanel } from "@/components/notifications/preferences-panel";

export default async function SettingsNotificationsPage() {
  const ctx = await loadSettingsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Settings"
      moduleHref="/settings/general"
      section="Notifications"
      title="Settings"
    >
      <NotificationPreferencesPanel initialRows={ctx.preferenceRows} />
    </ModulePageShell>
  );
}
