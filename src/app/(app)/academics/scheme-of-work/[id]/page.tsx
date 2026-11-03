import { notFound, redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/get-user";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { SchemeEditor } from "@/components/academics/scheme-of-work/scheme-editor";
import { createClient } from "@/lib/supabase/server";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { LESSON_PLAN_FLAG } from "@/lib/lesson-plans";
import { LessonPlansLink } from "@/components/academics/lesson-plans/lesson-plans-link";
import { loadSchemeDetail } from "../_data";

// assistSchemeEntry (invoked from SchemeEditor's AI Assist action on this
// page) had the same too-tight timeout risk generateSchemeWithAI did -- see
// that function's comment in scheme-of-work/actions.ts. Raised alongside it.
export const maxDuration = 60;

export default async function SchemeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const ctx = await loadSchemeDetail(id);
  if (!ctx.scheme) notFound();
  const showLessonPlans = await hasFeatureFlag(await createClient(), LESSON_PLAN_FLAG);

  return (
    <AppShell
      breadcrumbs={[
        { label: ctx.schoolName ?? "EduCore", href: "/dashboard" },
        { label: "Scheme of Work", href: "/academics/scheme-of-work" },
        { label: `${ctx.scheme.subject_name} — ${ctx.scheme.class_name}` },
      ]}
      userName={ctx.userName}
      userRole={ctx.userRole}
      onSignOut={logout}
    >
      {showLessonPlans && <LessonPlansLink schemeId={id} />}
      <SchemeEditor scheme={ctx.scheme} entries={ctx.entries} canEdit={ctx.canEdit} canReview={ctx.canReview} canGenerateAI={ctx.canGenerateAI} />
    </AppShell>
  );
}
