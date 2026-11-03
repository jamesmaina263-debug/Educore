import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import {
  LearningSection,
  type AttemptRow,
  type OptionRow,
  type QuizRow,
  type ResourceRow,
} from "@/components/learning/learning-section";
import Link from "next/link";
import { getSchoolSlug } from "@/lib/school-slug-server";
import { withSchoolSlug } from "@/lib/school-slug-href";
import { TUTOR_FLAG } from "@/lib/ai/tutor";
import { LEARNING_FLAG, type QuestionDraft, type QuizStatus, type ResourceKind } from "@/lib/learning-portal";

export default async function LearningPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  // Hidden entirely unless the school has the flag. hasFeatureFlag fails closed.
  if (!(await hasFeatureFlag(supabase, LEARNING_FLAG))) notFound();

  const [{ data: schoolUser }, { data: canRead }, { data: canWriteAny }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.read" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.write" }),
  ]);
  // Staff only. Learners and guardians use the portal.
  if (canRead !== true) notFound();

  const [{ data: streams }, { data: subjects }, { data: resourceRows }, { data: quizRows }, { data: questionRows }, { data: keyRows }, { data: attemptRows }] =
    await Promise.all([
      supabase.from("streams").select("id, name, classes(name)").order("name"),
      supabase.from("subjects").select("id, name").eq("is_active", true).order("name"),
      supabase
        .from("learning_resources")
        .select("id, stream_id, subject_id, kind, title, body, url, starts_at, paper_year, published, created_by")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("learning_quizzes")
        .select("id, stream_id, subject_id, title, description, max_attempts, show_answers, status, created_by")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("learning_quiz_questions").select("id, quiz_id, position, prompt, options, marks").order("position").limit(5000),
      supabase.from("learning_quiz_keys").select("question_id, correct_index").limit(5000),
      supabase.from("learning_quiz_attempts").select("quiz_id, student_id, score, total").limit(5000),
    ]);

  const streamOptions: OptionRow[] = (streams ?? []).map((s) => {
    const cls = s.classes as unknown as { name: string } | null;
    return { id: s.id as string, label: `${cls?.name ?? ""} ${s.name}`.trim() };
  });
  const subjectOptions: OptionRow[] = (subjects ?? []).map((s) => ({ id: s.id as string, label: s.name as string }));

  const showTutor = await hasFeatureFlag(supabase, TUTOR_FLAG);
  const tutorHref = showTutor ? withSchoolSlug(await getSchoolSlug(), "/academics/learning/tutor") : null;

  const me = (schoolUser?.id as string | undefined) ?? null;
  const canWrite = canWriteAny === true;

  const resources: ResourceRow[] = (resourceRows ?? []).map((r) => ({
    id: r.id as string,
    streamId: r.stream_id as string,
    subjectId: r.subject_id as string,
    kind: r.kind as ResourceKind,
    title: r.title as string,
    body: (r.body as string | null) ?? "",
    url: (r.url as string | null) ?? "",
    startsAt: (r.starts_at as string | null) ?? null,
    paperYear: r.paper_year === null ? "" : String(r.paper_year),
    published: r.published as boolean,
    editable: canWrite || r.created_by === me,
  }));

  const keys = new Map((keyRows ?? []).map((k) => [k.question_id as string, k.correct_index as number]));
  const questionsByQuiz = new Map<string, QuestionDraft[]>();
  for (const q of questionRows ?? []) {
    const list = questionsByQuiz.get(q.quiz_id as string) ?? [];
    list.push({
      prompt: q.prompt as string,
      options: (q.options as string[]) ?? [],
      correctIndex: keys.get(q.id as string) ?? 0,
      marks: q.marks as number,
    });
    questionsByQuiz.set(q.quiz_id as string, list);
  }
  const attempts: AttemptRow[] = (attemptRows ?? []).map((a) => ({
    quizId: a.quiz_id as string,
    studentId: a.student_id as string,
    score: a.score as number,
    total: a.total as number,
  }));
  const quizzes: QuizRow[] = (quizRows ?? []).map((q) => ({
    id: q.id as string,
    streamId: q.stream_id as string,
    subjectId: q.subject_id as string,
    title: q.title as string,
    description: (q.description as string | null) ?? "",
    maxAttempts: q.max_attempts as number,
    showAnswers: q.show_answers as boolean,
    status: q.status as QuizStatus,
    questions: questionsByQuiz.get(q.id as string) ?? [],
    editable: canWrite || q.created_by === me,
    hasAttempts: attempts.some((a) => a.quizId === q.id),
  }));

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Academics", href: "/academics" }, { label: "Learning" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      {tutorHref && (
        <p className="mb-3 text-sm">
          <Link className="text-primary hover:underline" href={tutorHref}>AI study guides (draft, review and approve)</Link>
        </p>
      )}
      <LearningSection
        streams={streamOptions}
        subjects={subjectOptions}
        resources={resources}
        quizzes={quizzes}
        attempts={attempts}
        today={new Date().toISOString()}
      />
    </AppShell>
  );
}
