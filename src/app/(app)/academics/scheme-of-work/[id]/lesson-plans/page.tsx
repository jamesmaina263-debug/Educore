import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { StartPlanButton } from "@/components/academics/lesson-plans/start-plan-button";
import { LESSON_PLAN_FLAG, coverage, statusLabel, type LessonPlanStatus } from "@/lib/lesson-plans";
import { loadSchemeDetail } from "../../_data";

export default async function SchemeLessonPlansPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  // Hidden entirely unless the school has the flag. hasFeatureFlag fails closed.
  if (!(await hasFeatureFlag(supabase, LESSON_PLAN_FLAG))) notFound();

  const ctx = await loadSchemeDetail(id);
  if (!ctx.scheme) notFound();

  const entryIds = ctx.entries.map((e) => e.id);
  const { data: planRows } = entryIds.length
    ? await supabase.from("lesson_plans").select("scheme_entry_id, status").in("scheme_entry_id", entryIds)
    : { data: [] as { scheme_entry_id: string; status: string }[] };
  const planByEntry = new Map((planRows ?? []).map((p) => [p.scheme_entry_id as string, p.status as LessonPlanStatus]));
  const summary = coverage(ctx.entries.map((e) => ({ entryId: e.id, planStatus: planByEntry.get(e.id) ?? null })));

  return (
    <AppShell
      breadcrumbs={[
        { label: ctx.schoolName ?? "EduCore", href: "/dashboard" },
        { label: "Scheme of Work", href: "/academics/scheme-of-work" },
        { label: `${ctx.scheme.subject_name} — ${ctx.scheme.class_name}`, href: `/academics/scheme-of-work/${id}` },
        { label: "Lesson plans" },
      ]}
      userName={ctx.userName}
      userRole={ctx.userRole}
      onSignOut={logout}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {summary.planned} of {summary.total} lessons have a plan ({summary.ready} ready, {summary.taught} taught). Plans start prefilled from the scheme row; you write and change the rest.
        </p>
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-3 py-2">Week</th>
                <th className="px-3 py-2">Lesson</th>
                <th className="px-3 py-2">Topic</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {ctx.entries.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">This scheme has no lesson rows yet.</td></tr>
              ) : (
                ctx.entries.map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className="px-3 py-2" data-numeric>{e.week_number}</td>
                    <td className="px-3 py-2" data-numeric>{e.lesson_number}</td>
                    <td className="px-3 py-2">{e.topic || "—"}</td>
                    <td className="px-3 py-2">{statusLabel(planByEntry.get(e.id) ?? null)}</td>
                    <td className="px-3 py-2 text-right">
                      <StartPlanButton schemeId={id} entryId={e.id} hasPlan={planByEntry.has(e.id)} canEdit={ctx.canEdit} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
