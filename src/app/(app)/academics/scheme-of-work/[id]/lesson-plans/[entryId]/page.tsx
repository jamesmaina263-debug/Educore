import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { LessonPlanEditor } from "@/components/academics/lesson-plans/lesson-plan-editor";
import { LESSON_PLAN_FLAG, type LessonPlanFields, type LessonPlanStatus } from "@/lib/lesson-plans";
import { loadSchemeDetail } from "../../../_data";

export default async function LessonPlanPage({ params }: { params: Promise<{ id: string; entryId: string }> }) {
  const { id, entryId } = await params;
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  if (!(await hasFeatureFlag(supabase, LESSON_PLAN_FLAG))) notFound();

  const ctx = await loadSchemeDetail(id);
  if (!ctx.scheme) notFound();
  const entry = ctx.entries.find((e) => e.id === entryId);
  if (!entry) notFound();

  const { data: plan } = await supabase.from("lesson_plans").select("*").eq("scheme_entry_id", entryId).maybeSingle();
  if (!plan) notFound(); // plans are created from the list page ("Start plan")

  const initial: LessonPlanFields = {
    objectives: (plan.objectives as string | null) ?? "",
    introduction: (plan.introduction as string | null) ?? "",
    development: (plan.development as string | null) ?? "",
    conclusion: (plan.conclusion as string | null) ?? "",
    assessment: (plan.assessment as string | null) ?? "",
    resources: (plan.resources as string | null) ?? "",
    homework: (plan.homework as string | null) ?? "",
    reflection: (plan.reflection as string | null) ?? "",
    durationMinutes: plan.duration_minutes === null ? null : Number(plan.duration_minutes),
    status: plan.status as LessonPlanStatus,
    taughtOn: (plan.taught_on as string | null) ?? null,
  };

  return (
    <AppShell
      breadcrumbs={[
        { label: ctx.schoolName ?? "EduCore", href: "/dashboard" },
        { label: "Scheme of Work", href: "/academics/scheme-of-work" },
        { label: `${ctx.scheme.subject_name} — ${ctx.scheme.class_name}`, href: `/academics/scheme-of-work/${id}` },
        { label: "Lesson plans", href: `/academics/scheme-of-work/${id}/lesson-plans` },
        { label: `Week ${entry.week_number}, lesson ${entry.lesson_number}` },
      ]}
      userName={ctx.userName}
      userRole={ctx.userRole}
      onSignOut={logout}
    >
      <div className="space-y-4">
        <div className="panel p-3 text-sm">
          <p className="font-medium">{entry.topic || "Untitled lesson"}{entry.subtopic ? ` — ${entry.subtopic}` : ""}</p>
          <p className="text-muted-foreground">From the scheme of work, week {entry.week_number}, lesson {entry.lesson_number}.</p>
        </div>
        <LessonPlanEditor planId={plan.id as string} schemeId={id} initial={initial} canEdit={ctx.canEdit} />
      </div>
    </AppShell>
  );
}
