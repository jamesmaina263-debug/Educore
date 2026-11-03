import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { ReportFormDesigner } from "@/components/settings/report-form-designer";
import { EMPTY_REPORT_FORM_LAYOUT, REPORT_FORM_FLAG, loadReportFormLayout } from "@/lib/academics/report-form-layout";

export default async function ReportFormPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");
  // Hidden entirely unless the school has the flag. hasFeatureFlag fails closed (any error => false).
  if (!(await hasFeatureFlag(supabase, REPORT_FORM_FLAG))) notFound();

  const [{ data: schoolUser }, { data: canWrite }] = await Promise.all([
    supabase.from("school_users").select("school_id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "exams.write" }),
  ]);
  const layout = schoolUser?.school_id ? ((await loadReportFormLayout(supabase, schoolUser.school_id as string)) ?? EMPTY_REPORT_FORM_LAYOUT) : EMPTY_REPORT_FORM_LAYOUT;

  return (
    <ModulePageShell
      schoolName={(schoolUser?.schools as unknown as { name: string } | null)?.name ?? "EduCore"}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={(schoolUser?.roles as unknown as { display_name: string } | null)?.display_name}
      moduleLabel="Settings"
      moduleHref="/settings/general"
      section="Report Form"
      title="Settings"
    >
      <ReportFormDesigner initial={layout} canWrite={canWrite === true} />
    </ModulePageShell>
  );
}
