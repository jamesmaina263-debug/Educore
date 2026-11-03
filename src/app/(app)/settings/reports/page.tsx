import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import Link from "next/link";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { REPORT_FORM_FLAG } from "@/lib/academics/report-form-layout";
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
  const customForms = await hasFeatureFlag(supabase, REPORT_FORM_FLAG);
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
      {customForms && (
        <p className="mt-4 text-sm text-muted-foreground">
          Want different wording on the printed card? <Link className="underline" href="/settings/report-form">Edit the report form</Link>. Need a custom list or marks export?{" "}
          <Link className="underline" href="/exams/report-builder">Open the report builder</Link>.
        </p>
      )}
    </ModulePageShell>
  );
}
