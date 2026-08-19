import { loadSettingsContext } from "../_data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { StaffRolesTable } from "@/components/settings/staff-roles-table";
import { InviteStaffDialog } from "@/components/settings/invite-staff-dialog";

export default async function SettingsStaffPage() {
  const ctx = await loadSettingsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Settings"
      moduleHref="/settings/general"
      section="Users & Roles"
      title="Settings"
      noAccess={!ctx.canReadStaff && !ctx.canManageStaff}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="label-eyebrow">{ctx.staff.length} staff</p>
          {ctx.canManageStaff && <InviteStaffDialog roles={ctx.roles} />}
        </div>
        <StaffRolesTable
          rows={ctx.staff}
          roles={ctx.roles}
          canManage={ctx.canManageStaff}
          canManagePermissions={ctx.canManagePermissions}
          currentUserId={ctx.currentUserId}
        />
      </div>
    </ModulePageShell>
  );
}
