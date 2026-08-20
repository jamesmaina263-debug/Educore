import { loadSettingsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { LeaveTypesPanel } from "@/components/settings/leave-types-panel";

export default async function SettingsLeaveTypesPage() {
  const ctx = await loadSettingsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Settings"
      moduleHref="/settings/general"
      section="Leave Types"
      title="Settings"
      noAccess={!ctx.canReadStaff && !ctx.canManageStaff}
    >
      <LeaveTypesPanel rows={ctx.leaveTypes} canManage={ctx.canManageStaff} />
    </ModulePageShell>
  );
}
