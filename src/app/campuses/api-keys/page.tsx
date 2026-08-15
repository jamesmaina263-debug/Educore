import { loadCampusesContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { ApiKeysPanel } from "@/components/settings/api-keys-panel";
import { issueGroupApiKey, revokeGroupApiKey } from "@/app/campuses/actions";

export default async function CampusesApiKeysPage() {
  const ctx = await loadCampusesContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Campuses"
      moduleHref="/campuses/overview"
      section="API Keys"
      title="Campuses"
      noAccess={!ctx.isGroupAdmin || !ctx.canManageApiKeys}
    >
      <ApiKeysPanel rows={ctx.apiKeyRows} canManage issueAction={issueGroupApiKey} revokeAction={revokeGroupApiKey} />
    </ModulePageShell>
  );
}
