import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { ReportBuilderForm } from "@/components/exams/report-builder-form";
import { REPORT_FORM_FLAG } from "@/lib/academics/report-form-layout";

type One<T> = T | T[] | null | undefined;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export default async function ReportBuilderPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");
  // Hidden entirely unless the school has the flag. hasFeatureFlag fails closed (any error => false).
  if (!(await hasFeatureFlag(supabase, REPORT_FORM_FLAG))) notFound();

  const [{ data: schoolUser }, { data: canLearners }, { data: canMarks }] = await Promise.all([
    supabase.from("school_users").select("school_id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "students.read" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "exams.read" }),
  ]);
  if (canLearners !== true && canMarks !== true) notFound();

  const [{ data: streamRows }, { data: examRows }] = await Promise.all([
    canLearners === true ? supabase.from("streams").select("id, name, classes(name, level_order)").order("name") : Promise.resolve({ data: [] }),
    canMarks === true ? supabase.from("exams").select("id, name, created_at").order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
  ]);
  const streams = ((streamRows ?? []) as unknown as { id: string; name: string; classes: One<{ name: string; level_order: number | null }> }[])
    .map((s) => ({ id: s.id, label: `${one(s.classes)?.name ?? ""} ${s.name}`.trim(), order: one(s.classes)?.level_order ?? 0 }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map(({ id, label }) => ({ id, label }));
  const exams = ((examRows ?? []) as unknown as { id: string; name: string }[]).map((x) => ({ id: x.id, label: x.name }));

  return (
    <ModulePageShell
      schoolName={(schoolUser?.schools as unknown as { name: string } | null)?.name ?? "EduCore"}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={(schoolUser?.roles as unknown as { display_name: string } | null)?.display_name}
      moduleLabel="Exams"
      moduleHref="/exams"
      section="Report Builder"
      title="Exams"
    >
      <ReportBuilderForm streams={streams} exams={exams} canLearners={canLearners === true} canMarks={canMarks === true} />
    </ModulePageShell>
  );
}
