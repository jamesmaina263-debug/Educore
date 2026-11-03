import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { isUuid } from "@/lib/bus-live";
import { LEARNING_FLAG, type ResourceKind } from "@/lib/learning-portal";
import { TUTOR_FLAG } from "@/lib/ai/tutor";
import { PortalLearning, type LearnerGuide, type LearnerQuestion, type LearnerQuiz, type LearnerResource } from "@/components/portal/portal-learning";

// WP 8.1 (3/3): where a learner, or a parent for their child, reads shared material and takes quizzes. Hidden (404)
// unless the signed-in account is a parent or student AND the school has the learning portal on. The database repeats
// every rule: learners only ever see PUBLISHED content for the class their child is currently in, never an answer key.
export default async function PortalLearningPage({ searchParams }: { searchParams: Promise<{ child?: string }> }) {
  const { child: childParam } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/parent-login");

  const { data: schoolUser } = await supabase.from("school_users").select("id, roles(name)").eq("auth_user_id", user.id).maybeSingle();
  const roleName = (schoolUser?.roles as unknown as { name: string } | null)?.name;
  if (!schoolUser || (roleName !== "parent" && roleName !== "student")) notFound();
  if (!(await hasFeatureFlag(supabase, LEARNING_FLAG))) notFound();

  type Learner = { id: string; first_name: string; current_class_id: string | null };
  let learners: Learner[] = [];
  if (roleName === "parent") {
    const { data: links } = await supabase.from("student_guardians").select("students(id, first_name, current_class_id)").eq("guardian_user_id", schoolUser.id);
    learners = (links ?? []).map((l) => l.students as unknown as Learner | null).filter((s): s is Learner => s !== null && isUuid(s.id));
  } else {
    const { data: own } = await supabase.from("students").select("id, first_name, current_class_id").eq("school_user_id", schoolUser.id);
    learners = (own ?? []).filter((s) => isUuid(s.id)) as Learner[];
  }
  const current = learners.find((l) => l.id === childParam) ?? learners[0] ?? null;

  let resources: LearnerResource[] = [];
  let quizzes: LearnerQuiz[] = [];
  let guides: LearnerGuide[] = [];
  if (current?.current_class_id) {
    const stream = current.current_class_id;
    const [{ data: subjects }, { data: resRows }, { data: quizRows }, { data: attemptRows }] = await Promise.all([
      supabase.from("subjects").select("id, name"),
      supabase.from("learning_resources").select("id, subject_id, kind, title, body, url, starts_at, paper_year").eq("stream_id", stream).eq("published", true).order("created_at", { ascending: false }).limit(300),
      supabase.from("learning_quizzes").select("id, subject_id, title, description, max_attempts").eq("stream_id", stream).eq("status", "published").order("created_at", { ascending: false }).limit(100),
      supabase.from("learning_quiz_attempts").select("quiz_id, attempt_no, score, total").eq("student_id", current.id).limit(500),
    ]);
    const subjectName = new Map((subjects ?? []).map((s) => [s.id as string, s.name as string]));
    const quizIds = (quizRows ?? []).map((q) => q.id as string);
    const { data: questionRows } = quizIds.length
      ? await supabase.from("learning_quiz_questions").select("quiz_id, position, prompt, options, marks").in("quiz_id", quizIds).order("position").limit(5000)
      : { data: [] as { quiz_id: string; position: number; prompt: string; options: string[]; marks: number }[] };

    // Teacher-approved AI study guides. The database only returns approved guides whose source notes are all still
    // published and unchanged; the status filter repeats that rule here.
    if (await hasFeatureFlag(supabase, TUTOR_FLAG)) {
      const { data: guideRows } = await supabase.from("tutor_drafts").select("id, subject_id, title, body, source_snapshot").eq("stream_id", stream).eq("status", "approved").order("created_at", { ascending: false }).limit(100);
      guides = (guideRows ?? []).map((g) => ({
        id: g.id as string,
        subject: subjectName.get(g.subject_id as string) ?? "Subject",
        title: g.title as string,
        body: g.body as string,
        sources: ((g.source_snapshot as { title?: string }[] | null) ?? []).map((s) => s.title ?? "").filter(Boolean),
      }));
    }

    resources = (resRows ?? []).map((r) => ({
      id: r.id as string,
      subject: subjectName.get(r.subject_id as string) ?? "Subject",
      kind: r.kind as ResourceKind,
      title: r.title as string,
      body: (r.body as string | null) ?? "",
      url: (r.url as string | null) ?? "",
      startsAt: (r.starts_at as string | null) ?? null,
      paperYear: r.paper_year === null ? null : Number(r.paper_year),
    }));
    const qByQuiz = new Map<string, LearnerQuestion[]>();
    for (const q of questionRows ?? []) {
      const list = qByQuiz.get(q.quiz_id as string) ?? [];
      list.push({ prompt: q.prompt as string, options: (q.options as string[]) ?? [], marks: q.marks as number });
      qByQuiz.set(q.quiz_id as string, list);
    }
    quizzes = (quizRows ?? []).map((q) => ({
      id: q.id as string,
      subject: subjectName.get(q.subject_id as string) ?? "Subject",
      title: q.title as string,
      description: (q.description as string | null) ?? "",
      maxAttempts: q.max_attempts as number,
      questions: qByQuiz.get(q.id as string) ?? [],
      attempts: (attemptRows ?? []).filter((a) => a.quiz_id === q.id).map((a) => ({ attemptNo: a.attempt_no as number, score: a.score as number, total: a.total as number })),
    }));
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-4 bg-background p-4">
      <Link href="/portal" className="text-xs text-muted-foreground underline">Back to portal</Link>
      <div className="panel space-y-4 p-4">
        <p className="label-eyebrow">Learning</p>
        {learners.length > 1 && (
          <p className="flex flex-wrap gap-2 text-sm">
            {learners.map((l) => (
              <Link key={l.id} href={`/portal/learning?child=${l.id}`} className={`rounded border px-2 py-1 ${l.id === current?.id ? "bg-muted font-medium" : ""}`}>{l.first_name}</Link>
            ))}
          </p>
        )}
        {!current ? (
          <p className="text-sm text-muted-foreground">Your child&apos;s information will appear here once the school has added it.</p>
        ) : !current.current_class_id ? (
          <p className="text-sm text-muted-foreground">{current.first_name} has not been placed in a class yet.</p>
        ) : (
          <PortalLearning studentId={current.id} resources={resources} quizzes={quizzes} guides={guides} />
        )}
      </div>
    </div>
  );
}
