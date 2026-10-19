import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { ReportSettingsForm } from "@/components/settings/report-settings-form";
import { DEFAULT_REPORT_SETTINGS, loadReportSettings } from "@/lib/academics/report-settings";

export default async function ReportSettingsPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canWrite }] = await Promise.all([
    supabase.from("school_users").select("school_id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "exams.write" }),
  ]);
  const settings = schoolUser?.school_id ? await loadReportSettings(supabase, schoolUser.school_id as string) : DEFAULT_REPORT_SETTINGS;

  return (
    <ModulePageShell
      schoolName={(schoolUser?.schools as unknown as { name: string } | null)?.name ?? "EduCore"}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={(schoolUser?.roles as unknown as { display_name: string } | null)?.display_name}
      moduleLabel="Settings"
      moduleHref="/settings/general"
      section="Report Settings"
      title="Settings"
    >
      <ReportSettingsForm initial={settings} canWrite={canWrite === true} />
    </ModulePageShell>
  );
}
