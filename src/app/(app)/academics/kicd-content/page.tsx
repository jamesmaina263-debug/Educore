import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { KICD_GRADES, isKicdGrade, kicdGradeLabel } from "@/lib/kicd-grade";
import { AdminKicdContentPanel, type KicdSourceRow } from "@/components/admin/admin-kicd-content-panel";

interface SubStrandRow {
  id: string;
  name: string;
  level_order: number;
  learning_outcomes: string | null;
  key_inquiry_questions: string | null;
  rubric_text: string | null;
}

interface StrandRow {
  id: string;
  name: string;
  grade: string;
  level_order: number;
  kicd_learning_areas: { name: string; display_order: number } | null;
  kicd_sub_strands: SubStrandRow[];
}

interface SourceRow {
  id: string;
  name: string;
  attribution: string;
  licence_reference: string;
  kicd_strands: StrandRow[];
}

// KICD content for school management (academics.write: school_owner / principal /
// deputy_principal). Two parts:
//  1. Manage -- the school's OWN KICD content (school_id = this school): import, review/edit,
//     publish, withdraw, discard. Private to this school; RLS (kicd_can_manage_source) stops
//     it touching any other school's or the platform-wide content.
//  2. Browse -- read-only view of the platform-wide content published by EduCore
//     (school_id is null, is_enabled = true). The filters are explicit (not left to RLS)
//     because a platform super-admin's RLS also returns unpublished/withdrawn sources.
export default async function KicdContentBrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ grade?: string }>;
}) {
  const { grade: gradeParam } = await searchParams;
  const selectedGrade = isKicdGrade(gradeParam) ? gradeParam : null;

  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canWrite }] = await Promise.all([
    supabase.from("school_users").select("full_name, school_id, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.write" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;
  const canView = canWrite === true;

  let ownSources: KicdSourceRow[] = [];
  if (canView && schoolUser?.school_id) {
    const { data: own } = await supabase
      .from("kicd_content_sources")
      .select(
        "id, name, licence_reference, licence_scope, attribution, source_document, is_enabled, created_at, kicd_strands(id, name, grade, kicd_learning_areas(name), kicd_sub_strands(id, name, learning_outcomes, key_inquiry_questions, rubric_text))",
      )
      .eq("school_id", schoolUser.school_id)
      .order("created_at", { ascending: false });
    ownSources = (own ?? []) as unknown as KicdSourceRow[];
  }

  let sources: SourceRow[] = [];
  if (canView) {
    let query = supabase
      .from("kicd_content_sources")
      .select(
        "id, name, attribution, licence_reference, kicd_strands(id, name, grade, level_order, kicd_learning_areas(name, display_order), kicd_sub_strands(id, name, level_order, learning_outcomes, key_inquiry_questions, rubric_text))",
      )
      .eq("is_enabled", true)
      .is("school_id", null)
      .order("created_at", { ascending: false });
    if (selectedGrade) query = query.eq("kicd_strands.grade", selectedGrade);
    const { data } = await query;
    sources = ((data ?? []) as unknown as SourceRow[])
      .map((s) => ({ ...s, kicd_strands: selectedGrade ? s.kicd_strands.filter((k) => k.grade === selectedGrade) : s.kicd_strands }))
      .filter((s) => s.kicd_strands.length > 0 || !selectedGrade);
  }

  const gradeOrder = (g: string) => KICD_GRADES.findIndex((x) => x.value === g);

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Academics", href: "/academics/subjects" }, { label: "KICD Content" }]}
      userName={schoolUser?.full_name}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">KICD Content</h1>
          <p className="text-sm text-muted-foreground">
            Import and manage your school&apos;s own KICD curriculum content, and browse the official content EduCore publishes for all
            schools.
          </p>
        </div>

        {!canView ? (
          <p className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
            You don&apos;t have permission to view KICD content.
          </p>
        ) : (
          <>
            <section className="flex flex-col gap-2">
              <div>
                <h2 className="text-base font-semibold">Your school&apos;s KICD content</h2>
                <p className="text-sm text-muted-foreground">
                  Every import needs a licence reference and attribution, starts <strong>unpublished</strong>, and is only visible to your
                  school once you review and publish it. Only your school&apos;s management can see or change it.
                </p>
              </div>
              <AdminKicdContentPanel sources={ownSources} />
            </section>

            <div>
              <h2 className="text-base font-semibold">Published by EduCore</h2>
              <p className="text-sm text-muted-foreground">Read-only reference content shared with all schools.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Grade:</span>
              <Link
                href="/academics/kicd-content"
                className={`rounded-md border px-2 py-1 ${selectedGrade === null ? "bg-muted font-medium" : "hover:bg-muted"}`}
              >
                All
              </Link>
              {KICD_GRADES.map((g) => (
                <Link
                  key={g.value}
                  href={`/academics/kicd-content?grade=${g.value}`}
                  className={`rounded-md border px-2 py-1 ${selectedGrade === g.value ? "bg-muted font-medium" : "hover:bg-muted"}`}
                >
                  {g.label}
                </Link>
              ))}
            </div>

            {sources.length === 0 ? (
              <p className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
                {selectedGrade
                  ? `No published KICD content for ${kicdGradeLabel(selectedGrade)} yet.`
                  : "No KICD content has been published yet."}
              </p>
            ) : (
              sources.map((source) => {
                const strands = [...source.kicd_strands].sort(
                  (a, b) =>
                    gradeOrder(a.grade) - gradeOrder(b.grade) ||
                    (a.kicd_learning_areas?.display_order ?? 0) - (b.kicd_learning_areas?.display_order ?? 0) ||
                    (a.kicd_learning_areas?.name ?? "").localeCompare(b.kicd_learning_areas?.name ?? "") ||
                    a.level_order - b.level_order,
                );
                return (
                  <section key={source.id} className="panel flex flex-col gap-3 p-4">
                    <div>
                      <h2 className="text-base font-semibold">{source.name}</h2>
                      <p className="text-xs text-muted-foreground">{source.attribution}</p>
                    </div>
                    {strands.length === 0 ? (
                      <p className="text-sm text-muted-foreground">This source has no strands.</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {strands.map((strand) => (
                          <details key={strand.id} className="rounded-md border p-3">
                            <summary className="cursor-pointer text-sm font-medium">
                              {kicdGradeLabel(strand.grade) ?? strand.grade} · {strand.kicd_learning_areas?.name ?? "Learning area"} · {strand.name}
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                {strand.kicd_sub_strands.length} sub-strand{strand.kicd_sub_strands.length === 1 ? "" : "s"}
                              </span>
                            </summary>
                            <div className="mt-3 flex flex-col gap-3">
                              {[...strand.kicd_sub_strands]
                                .sort((a, b) => a.level_order - b.level_order)
                                .map((sub) => (
                                  <div key={sub.id} className="flex flex-col gap-1 border-l-2 pl-3 text-sm">
                                    <p className="font-medium">{sub.name}</p>
                                    {sub.learning_outcomes && (
                                      <p>
                                        <span className="text-muted-foreground">Learning outcomes: </span>
                                        <span className="whitespace-pre-line">{sub.learning_outcomes}</span>
                                      </p>
                                    )}
                                    {sub.key_inquiry_questions && (
                                      <p>
                                        <span className="text-muted-foreground">Key inquiry questions: </span>
                                        <span className="whitespace-pre-line">{sub.key_inquiry_questions}</span>
                                      </p>
                                    )}
                                    {sub.rubric_text && (
                                      <p>
                                        <span className="text-muted-foreground">Rubric: </span>
                                        <span className="whitespace-pre-line">{sub.rubric_text}</span>
                                      </p>
                                    )}
                                  </div>
                                ))}
                            </div>
                          </details>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
