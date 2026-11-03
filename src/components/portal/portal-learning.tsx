"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitLearningQuizAction } from "@/app/portal/learning/actions";
import { RESOURCE_LABELS, isHttpsUrl, type ResourceKind } from "@/lib/learning-portal";
import { attemptsLeft, bestOf, buildAnswers, formatScore, unansweredCount, type SubmitResult, type TakeAttempt } from "@/lib/learning-quiz-taking";

export interface LearnerResource {
  id: string;
  subject: string;
  kind: ResourceKind;
  title: string;
  body: string;
  url: string;
  startsAt: string | null;
  paperYear: number | null;
}
export interface LearnerGuide { id: string; subject: string; title: string; body: string; sources: string[] }
export interface LearnerQuestion { prompt: string; options: string[]; marks: number }
export interface LearnerQuiz {
  id: string;
  subject: string;
  title: string;
  description: string;
  maxAttempts: number;
  questions: LearnerQuestion[];
  attempts: TakeAttempt[];
}

const KIND_ORDER: ResourceKind[] = ["live_lesson", "note", "video", "past_paper", "link"];

function ResourceItem({ r }: { r: LearnerResource }) {
  const safe = r.url && isHttpsUrl(r.url);
  return (
    <li className="rounded border p-3 text-sm">
      <p className="font-medium">{r.title}</p>
      <p className="text-xs text-muted-foreground">
        {r.subject}
        {r.paperYear ? ` · ${r.paperYear}` : ""}
        {r.kind === "live_lesson" && r.startsAt ? ` · ${new Date(r.startsAt).toLocaleString()}` : ""}
      </p>
      {r.body && <p className="mt-2 whitespace-pre-wrap">{r.body}</p>}
      {safe && (
        <a href={r.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block underline underline-offset-2">
          {r.kind === "live_lesson" ? "Join the lesson" : "Open"} (opens in a new tab)
        </a>
      )}
    </li>
  );
}

function QuizTaker({ quiz, studentId }: { quiz: LearnerQuiz; studentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<(number | null)[]>([]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const left = result ? result.attemptsLeft : attemptsLeft(quiz.maxAttempts, quiz.attempts);
  const best = bestOf(quiz.attempts);
  const counts = quiz.questions.map((q) => q.options.length);

  function submit() {
    setError(null);
    const answers = buildAnswers(selected, counts);
    const blank = unansweredCount(answers);
    if (blank > 0 && !window.confirm(`${blank} question${blank === 1 ? " is" : "s are"} unanswered. Submit anyway?`)) return;
    start(async () => {
      const r = await submitLearningQuizAction(quiz.id, studentId, answers);
      if ("error" in r) setError(r.error);
      else { setResult(r.result); setOpen(false); router.refresh(); }
    });
  }

  return (
    <li className="rounded border p-3 text-sm">
      <p className="font-medium">{quiz.title}</p>
      <p className="text-xs text-muted-foreground">
        {quiz.subject} · {quiz.questions.length} question{quiz.questions.length === 1 ? "" : "s"} · {left} attempt{left === 1 ? "" : "s"} left
        {best ? ` · best ${formatScore(best.score, best.total)}` : ""}
      </p>
      {quiz.description && <p className="mt-1">{quiz.description}</p>}

      {result && (
        <div role="status" className="mt-2 rounded bg-muted p-2">
          <p className="font-medium">Attempt {result.attemptNo}: {formatScore(result.score, result.total)}</p>
          {result.review && (
            <ul className="mt-1 text-xs">
              {result.review.map((rv) => (
                <li key={rv.position}>
                  Q{rv.position}: {rv.yourAnswer === rv.correctIndex ? "correct" : `correct answer was option ${rv.correctIndex + 1}${rv.yourAnswer === null ? " (not answered)" : ""}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-destructive">{error}</p>}

      {!open && left > 0 && quiz.questions.length > 0 && (
        <button type="button" className="mt-2 rounded bg-primary px-3 py-1.5 text-primary-foreground" onClick={() => { setOpen(true); setSelected([]); setResult(null); }}>
          {quiz.attempts.length === 0 && !result ? "Start quiz" : "Try again"}
        </button>
      )}

      {open && (
        <div className="mt-3 space-y-4">
          {quiz.questions.map((q, qi) => (
            <fieldset key={qi} className="space-y-1">
              <legend className="font-medium">{qi + 1}. {q.prompt} <span className="text-xs text-muted-foreground">({q.marks} mark{q.marks === 1 ? "" : "s"})</span></legend>
              {q.options.map((o, oi) => (
                <label key={oi} className="flex items-center gap-2">
                  <input type="radio" name={`${quiz.id}-${qi}`} checked={selected[qi] === oi} onChange={() => setSelected((prev) => { const next = [...prev]; next[qi] = oi; return next; })} />
                  <span>{o}</span>
                </label>
              ))}
            </fieldset>
          ))}
          <div className="flex gap-2">
            <button type="button" className="rounded bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50" disabled={pending} onClick={submit}>{pending ? "Marking…" : "Submit answers"}</button>
            <button type="button" className="rounded border px-3 py-1.5" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </li>
  );
}

export function PortalLearning({ studentId, resources, quizzes, guides = [] }: { studentId: string; resources: LearnerResource[]; quizzes: LearnerQuiz[]; guides?: LearnerGuide[] }) {
  const grouped = KIND_ORDER.map((k) => ({ kind: k, items: resources.filter((r) => r.kind === k) })).filter((g) => g.items.length > 0);
  return (
    <div className="space-y-5">
      {guides.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Study guides</h2>
          <ul className="space-y-2">
            {guides.map((g) => (
              <li key={g.id} className="rounded border p-3 text-sm">
                <p className="font-medium">{g.title}</p>
                <p className="text-xs text-muted-foreground">{g.subject} · Written with AI from your teacher&apos;s notes and approved by your teacher</p>
                <p className="mt-2 whitespace-pre-wrap">{g.body}</p>
                {g.sources.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Based on: {g.sources.join(", ")}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {quizzes.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Quizzes</h2>
          <ul className="space-y-2">{quizzes.map((q) => <QuizTaker key={q.id} quiz={q} studentId={studentId} />)}</ul>
        </section>
      )}
      {grouped.map((g) => (
        <section key={g.kind} className="space-y-2">
          <h2 className="text-sm font-semibold">{RESOURCE_LABELS[g.kind]}</h2>
          <ul className="space-y-2">{g.items.map((r) => <ResourceItem key={r.id} r={r} />)}</ul>
        </section>
      ))}
      {quizzes.length === 0 && grouped.length === 0 && guides.length === 0 && <p className="text-sm text-muted-foreground">Nothing has been shared for this class yet.</p>}
    </div>
  );
}
