import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { TutorSection, type TutorDraftRow } from "@/components/learning/tutor-section";
import { LEARNING_FLAG } from "@/lib/learning-portal";
import { TUTOR_FLAG } from "@/lib/ai/tutor";

export default async function TutorPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  // Hidden entirely unless the school has BOTH flags. hasFeatureFlag fails closed.
  if (!(await hasFeatureFlag(supabase, LEARNING_FLAG)) || !(await hasFeatureFlag(supabase, TUTOR_FLAG))) notFound();

  const [{ data: schoolUser }, { data: canRead }, { data: canWriteAny }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.read" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.write" }),
  ]);
  if (canRead !== true) notFound(); // staff only

  const [{ data: streams }, { data: subjects }, { data: noteRows }, { data: draftRows }] = await Promise.all([
    supabase.from("streams").select("id, name, classes(name)").order("name"),
    supabase.from("subjects").select("id, name").eq("is_active", true).order("name"),
    supabase.from("learning_resources").select("id, stream_id, subject_id, title").eq("kind", "note").eq("published", true).order("title").limit(1000),
    supabase.from("tutor_drafts").select("id, stream_id, subject_id, title, body, status, source_snapshot, model, created_by, created_at").order("created_at", { ascending: false }).limit(100),
  ]);

  const me = (schoolUser?.id as string | undefined) ?? null;
  const drafts: TutorDraftRow[] = (draftRows ?? []).map((d) => ({
    id: d.id as string,
    streamId: d.stream_id as string,
    subjectId: d.subject_id as string,
    title: d.title as string,
    body: d.body as string,
    status: d.status as TutorDraftRow["status"],
    sources: ((d.source_snapshot as { title?: string }[] | null) ?? []).map((s) => s.title ?? "").filter(Boolean),
    model: (d.model as string | null) ?? "AI",
    createdAt: d.created_at as string,
    editable: canWriteAny === true || d.created_by === me,
  }));

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Academics", href: "/academics" }, { label: "Learning", href: "/academics/learning" }, { label: "AI tutor" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <TutorSection
        streams={(streams ?? []).map((s) => ({ id: s.id as string, label: `${(s.classes as unknown as { name: string } | null)?.name ?? ""} ${s.name as string}`.trim() }))}
        subjects={(subjects ?? []).map((s) => ({ id: s.id as string, label: s.name as string }))}
        notes={(noteRows ?? []).map((n) => ({ id: n.id as string, streamId: n.stream_id as string, subjectId: n.subject_id as string, title: n.title as string }))}
        drafts={drafts}
      />
    </AppShell>
  );
}
