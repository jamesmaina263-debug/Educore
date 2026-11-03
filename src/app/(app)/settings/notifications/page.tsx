import { loadSettingsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { NotificationPreferencesPanel } from "@/components/notifications/preferences-panel";
import { PushNotificationsToggle } from "@/components/pwa/push-notifications-toggle";
import { createClient } from "@/lib/supabase/server";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { PUSH_FLAG, looksLikeVapidPublicKey } from "@/lib/push/payload";

export default async function SettingsNotificationsPage() {
  const ctx = await loadSettingsContext();
  // Push notifications toggle: only where the school has the flag on (fails closed).
  const pushOn = await hasFeatureFlag(await createClient(), PUSH_FLAG);
  const pushKey = looksLikeVapidPublicKey(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) ? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY : null;
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
      {pushOn && (
        <div className="panel mt-4 p-4">
          <p className="label-eyebrow mb-2">Phone notifications</p>
          <PushNotificationsToggle publicKey={pushKey} />
        </div>
      )}
    </ModulePageShell>
  );
}
