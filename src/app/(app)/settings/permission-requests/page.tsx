import { loadPermissionRequestsContext } from "../permission-requests-data";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { PermissionRequestsPanel } from "@/components/settings/permission-requests-panel";

export default async function PermissionRequestsPage() {
  const ctx = await loadPermissionRequestsContext();
  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Settings"
      moduleHref="/settings/general"
      section="Permission Requests"
      title="Settings"
      noAccess={false}
    >
      <PermissionRequestsPanel
        canManagePermissions={ctx.canManagePermissions}
        initialMyRequests={ctx.myRequests}
        initialPendingForReview={ctx.pendingForReview}
      />
    </ModulePageShell>
  );
}
