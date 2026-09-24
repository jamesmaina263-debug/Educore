import { redirect } from "next/navigation";
import { loadSettingsContext } from "../_data";
import { getCachedUser } from "@/lib/supabase/get-user";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { AccountSecurityPanel } from "@/components/settings/account-security-panel";

export default async function SettingsAccountPage() {
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const ctx = await loadSettingsContext();

  return (
    <ModulePageShell
      schoolName={ctx.schoolName}
      userName={ctx.userName}
      userRole={ctx.userRole}
      moduleLabel="Settings"
      moduleHref="/settings/general"
      section="Account"
      title="Settings"
      subtitle="Applies to your account only"
    >
      <AccountSecurityPanel userEmail={user.email ?? ctx.userName} />
    </ModulePageShell>
  );
}
