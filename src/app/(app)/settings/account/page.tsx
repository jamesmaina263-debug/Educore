import { redirect } from "next/navigation";
import { loadSettingsContext } from "../_data";
import { createClient } from "@/lib/supabase/server";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { AccountSecurityPanel } from "@/components/settings/account-security-panel";

export default async function SettingsAccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
