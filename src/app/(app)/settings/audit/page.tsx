import { loadSettingsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { AuditLogPanel } from "@/components/settings/audit-log-panel";

export default async function SettingsAuditPage() {
  const ctx = await loadSettingsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Settings"
      moduleHref="/settings/general"
      section="Audit Log"
      title="Settings"
      noAccess={!ctx.canReadAudit}
    >
      <AuditLogPanel />
    </ModulePageShell>
  );
}
