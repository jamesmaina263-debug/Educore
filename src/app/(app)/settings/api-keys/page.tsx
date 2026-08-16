import { loadSettingsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { ApiKeysPanel } from "@/components/settings/api-keys-panel";
import { issueSchoolApiKey, revokeSchoolApiKey } from "@/app/(app)/settings/actions";

export default async function SettingsApiKeysPage() {
  const ctx = await loadSettingsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Settings"
      moduleHref="/settings/general"
      section="API Keys"
      title="Settings"
      noAccess={!ctx.canManageApiKeys}
    >
      <ApiKeysPanel rows={ctx.apiKeyRows} canManage issueAction={issueSchoolApiKey} revokeAction={revokeSchoolApiKey} />
    </ModulePageShell>
  );
}
