import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { ReviewButton, TutorQaSettings } from "@/components/learning/tutor-qa-admin";
import { LEARNING_FLAG } from "@/lib/learning-portal";
import { TUTOR_FLAG } from "@/lib/ai/tutor";
import { QA_FLAG } from "@/lib/ai/tutor-qa";

type QRow = { id: string; question: string; status: string; answer: string | null; review_status: string; created_at: string; students: { first_name: string; last_name: string } | null };

const STATUS_LABEL: Record<string, string> = { answered: "Answered", not_covered: "Not in the guides", blocked_personal: "Personal details blocked", safeguarding: "Worrying message" };

export default async function TutorQuestionsPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");
  if (!(await hasFeatureFlag(supabase, LEARNING_FLAG)) || !(await hasFeatureFlag(supabase, TUTOR_FLAG)) || !(await hasFeatureFlag(supabase, QA_FLAG))) notFound();

  const [{ data: schoolUser }, { data: canRead }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(name, display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.read" }),
  ]);
  if (canRead !== true) notFound(); // staff only
  const roleName = (schoolUser?.roles as unknown as { name: string; display_name: string } | null)?.name;
  const roleLabel = (schoolUser?.roles as unknown as { name: string; display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;
  const canConfigure = roleName === "school_owner" || roleName === "principal";

  const [{ data: settings }, { data: staffRows }, { data: rows }] = await Promise.all([
    supabase.from("tutor_qa_school_settings").select("safeguarding_contact_id, dpia_confirmed_at, parent_notice_confirmed_at, retention_days, daily_question_limit").maybeSingle(),
    supabase.from("school_users").select("id, full_name, roles(name)").eq("status", "active").order("full_name").limit(500),
    supabase.from("tutor_qa_questions").select("id, question, status, answer, review_status, created_at, students(first_name, last_name)").order("created_at", { ascending: false }).limit(200),
  ]);
  const staff = (staffRows ?? [])
    .filter((s) => { const r = (s.roles as unknown as { name: string } | null)?.name; return r !== "parent" && r !== "student"; })
    .map((s) => ({ id: s.id as string, name: s.full_name as string }));
  const questions = (rows ?? []) as unknown as QRow[];
  const flagged = questions.filter((q) => q.review_status === "new");
  const others = questions.filter((q) => q.review_status !== "new");

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Academics", href: "/academics" }, { label: "Learning", href: "/academics/learning" }, { label: "AI tutor", href: "/academics/learning/tutor" }, { label: "Learner questions" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleLabel}
      onSignOut={logout}
    >
      <div className="space-y-5">
        <TutorQaSettings
          staff={staff}
          contactId={(settings?.safeguarding_contact_id as string | null) ?? null}
          dpia={Boolean(settings?.dpia_confirmed_at)}
          notice={Boolean(settings?.parent_notice_confirmed_at)}
          canConfigure={canConfigure}
        />
        <p className="text-xs text-muted-foreground">
          Questions are kept for {(settings?.retention_days as number | undefined) ?? 90} days and then removed. Each learner can ask up to {(settings?.daily_question_limit as number | undefined) ?? 10} a day.
          Answers come only from approved study guides and are written by AI: please look at them from time to time.
        </p>

        <section className="space-y-2" aria-labelledby="flagged-title">
          <h2 id="flagged-title" className="text-sm font-semibold">Worrying messages to follow up ({flagged.length})</h2>
          {flagged.length === 0 ? <p className="text-sm text-muted-foreground">None waiting.</p> : (
            <ul className="space-y-2">
              {flagged.map((q) => (
                <li key={q.id} className="rounded border border-destructive/50 p-3 text-sm">
                  <p className="font-medium">{q.students ? `${q.students.first_name} ${q.students.last_name}` : "Learner"} · {new Date(q.created_at).toLocaleString()}</p>
                  <p className="mt-1 whitespace-pre-wrap">{q.question}</p>
                  <p className="mt-1 text-xs text-muted-foreground">The learner was told to speak to a teacher or trusted adult today. Please follow your school&apos;s safeguarding procedure.</p>
                  <div className="mt-2"><ReviewButton id={q.id} /></div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2" aria-labelledby="all-title">
          <h2 id="all-title" className="text-sm font-semibold">Recent questions</h2>
          {others.length === 0 ? <p className="text-sm text-muted-foreground">No questions yet.</p> : (
            <ul className="space-y-2">
              {others.map((q) => (
                <li key={q.id} className="rounded border p-3 text-sm">
                  <p className="text-xs text-muted-foreground">
                    {q.students ? `${q.students.first_name} ${q.students.last_name}` : "Learner"} · {new Date(q.created_at).toLocaleString()} · {STATUS_LABEL[q.status] ?? q.status}{q.review_status === "reviewed" ? " · followed up" : ""}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{q.question}</p>
                  {q.answer && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{q.answer}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
