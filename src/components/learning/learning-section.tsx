"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { deleteResourceAction, saveQuizAction, saveResourceAction } from "@/app/(app)/academics/learning/actions";
import {
  MAX_OPTIONS,
  MAX_QUESTIONS,
  MIN_OPTIONS,
  QUIZ_STATUSES,
  QUIZ_STATUS_LABELS,
  RESOURCE_KINDS,
  RESOURCE_LABELS,
  blankQuestion,
  isUpcomingLesson,
  quizStats,
  type QuestionDraft,
  type QuizInput,
  type QuizStatus,
  type ResourceInput,
  type ResourceKind,
} from "@/lib/learning-portal";

export interface OptionRow {
  id: string;
  label: string;
}
export interface ResourceRow {
  id: string;
  streamId: string;
  subjectId: string;
  kind: ResourceKind;
  title: string;
  body: string;
  url: string;
  startsAt: string | null;
  paperYear: string;
  published: boolean;
  editable: boolean;
}
export interface QuizRow {
  id: string;
  streamId: string;
  subjectId: string;
  title: string;
  description: string;
  maxAttempts: number;
  showAnswers: boolean;
  status: QuizStatus;
  questions: QuestionDraft[];
  editable: boolean;
  hasAttempts: boolean;
}
export interface AttemptRow {
  quizId: string;
  studentId: string;
  score: number;
  total: number;
}

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function quizTone(s: QuizStatus): "success" | "neutral" | "info" {
  return s === "published" ? "success" : s === "closed" ? "info" : "neutral";
}

export function LearningSection({
  streams,
  subjects,
  resources,
  quizzes,
  attempts,
  today,
}: {
  streams: OptionRow[];
  subjects: OptionRow[];
  resources: ResourceRow[];
  quizzes: QuizRow[];
  attempts: AttemptRow[];
  today: string;
}) {
  const [tab, setTab] = useState<"resources" | "quizzes">("resources");
  const [res, setRes] = useState<ResourceInput | null>(null);
  const [quiz, setQuiz] = useState<QuizInput | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const label = (list: OptionRow[], id: string) => list.find((o) => o.id === id)?.label ?? "—";
  const now = new Date(today);

  async function run(fn: () => Promise<{ error: string } | { success: true }>, ok: string, after?: () => void) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      if ("error" in result) setError(result.error);
      else {
        setNotice(ok);
        after?.();
      }
    } finally {
      setBusy(false);
    }
  }

  function newResource() {
    setRes({ id: null, streamId: streams[0]?.id ?? "", subjectId: subjects[0]?.id ?? "", kind: "note", title: "", body: "", url: "", startsAt: "", paperYear: "", published: true });
    setError(null);
    setNotice(null);
  }
  function editResource(r: ResourceRow) {
    setRes({ id: r.id, streamId: r.streamId, subjectId: r.subjectId, kind: r.kind, title: r.title, body: r.body, url: r.url, startsAt: toLocalInput(r.startsAt), paperYear: r.paperYear, published: r.published });
    setError(null);
    setNotice(null);
  }
  function newQuiz() {
    setFrozen(false);
    setQuiz({ id: null, streamId: streams[0]?.id ?? "", subjectId: subjects[0]?.id ?? "", title: "", description: "", maxAttempts: 1, showAnswers: false, status: "draft", questions: [blankQuestion()] });
    setError(null);
    setNotice(null);
  }
  function editQuiz(q: QuizRow) {
    setFrozen(q.hasAttempts);
    setQuiz({ id: q.id, streamId: q.streamId, subjectId: q.subjectId, title: q.title, description: q.description, maxAttempts: q.maxAttempts, showAnswers: q.showAnswers, status: q.status, questions: q.hasAttempts ? null : q.questions.map((x) => ({ ...x, options: [...x.options] })) });
    setError(null);
    setNotice(null);
  }

  function setQuestion(n: number, patch: Partial<QuestionDraft>) {
    if (!quiz || !quiz.questions) return;
    setQuiz({ ...quiz, questions: quiz.questions.map((q, i) => (i === n ? { ...q, ...patch } : q)) });
  }

  const noClassesYet = streams.length === 0 || subjects.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Learning</h1>
        <p className="text-sm text-muted-foreground">
          Share notes, videos, past papers and live-lesson links with a class, and set short quizzes that mark themselves. Learners and
          parents see only what you publish. Links must start with https://; nothing is uploaded and nothing is sent to anyone.
        </p>
      </div>
      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      {notice && <p className="rounded-md border p-2 text-sm text-muted-foreground">{notice}</p>}
      {noClassesYet && (
        <p className="rounded-md border p-2 text-sm text-muted-foreground">Add at least one class stream and one subject before creating learning material.</p>
      )}

      <div className="flex gap-2" role="tablist">
        {(["resources", "quizzes"] as const).map((t) => (
          <Button key={t} role="tab" aria-selected={tab === t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>
            {t === "resources" ? `Material (${resources.length})` : `Quizzes (${quizzes.length})`}
          </Button>
        ))}
      </div>

      {tab === "resources" && (
        <div className="panel p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">{res ? (res.id ? "Edit material" : "New material") : "Class material"}</p>
            {!res && <Button size="sm" disabled={noClassesYet} onClick={newResource}>New material</Button>}
          </div>
          {res && (
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="r-kind">Kind</Label>
                <select id="r-kind" className={selectClass} value={res.kind} onChange={(e) => setRes({ ...res, kind: e.target.value as ResourceKind })}>
                  {RESOURCE_KINDS.map((k) => <option key={k} value={k}>{RESOURCE_LABELS[k]}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="r-title">Title</Label>
                <Input id="r-title" value={res.title} maxLength={150} onChange={(e) => setRes({ ...res, title: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="r-stream">Class</Label>
                <select id="r-stream" className={selectClass} value={res.streamId} onChange={(e) => setRes({ ...res, streamId: e.target.value })}>
                  {streams.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="r-subject">Subject</Label>
                <select id="r-subject" className={selectClass} value={res.subjectId} onChange={(e) => setRes({ ...res, subjectId: e.target.value })}>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              {res.kind === "note" ? (
                <div className="sm:col-span-2">
                  <Label htmlFor="r-body">Note</Label>
                  <Textarea id="r-body" rows={6} maxLength={8000} value={res.body} onChange={(e) => setRes({ ...res, body: e.target.value })} />
                </div>
              ) : (
                <div className="sm:col-span-2">
                  <Label htmlFor="r-url">{res.kind === "live_lesson" ? "Meeting link" : "Link"} (https://)</Label>
                  <Input id="r-url" type="url" value={res.url} maxLength={500} placeholder="https://" onChange={(e) => setRes({ ...res, url: e.target.value })} />
                </div>
              )}
              {res.kind === "live_lesson" && (
                <div>
                  <Label htmlFor="r-start">Starts</Label>
                  <Input id="r-start" type="datetime-local" value={res.startsAt} onChange={(e) => setRes({ ...res, startsAt: e.target.value })} />
                </div>
              )}
              {res.kind === "past_paper" && (
                <div>
                  <Label htmlFor="r-year">Year (optional)</Label>
                  <Input id="r-year" inputMode="numeric" value={res.paperYear} maxLength={4} onChange={(e) => setRes({ ...res, paperYear: e.target.value.replace(/\D/g, "") })} />
                </div>
              )}
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={res.published} onChange={(e) => setRes({ ...res, published: e.target.checked })} />
                Published (learners and parents of this class can see it)
              </label>
              <div className="flex gap-2 sm:col-span-2">
                <Button disabled={busy} onClick={() => run(() => saveResourceAction(res), "Material saved.", () => setRes(null))}>{busy ? "Saving..." : "Save"}</Button>
                <Button variant="outline" disabled={busy} onClick={() => setRes(null)}>Close</Button>
              </div>
            </div>
          )}
          {resources.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing shared yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {resources.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {RESOURCE_LABELS[r.kind]} · {label(streams, r.streamId)} · {label(subjects, r.subjectId)}
                      {r.kind === "past_paper" && r.paperYear ? ` · ${r.paperYear}` : ""}
                      {r.kind === "live_lesson" && r.startsAt ? ` · ${new Date(r.startsAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.kind === "live_lesson" && r.startsAt && isUpcomingLesson(r.startsAt, now) && <StatusBadge tone="info" label="Upcoming" />}
                    <StatusBadge tone={r.published ? "success" : "neutral"} label={r.published ? "Published" : "Draft"} />
                    {r.editable && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => editResource(r)}>Edit</Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (window.confirm(`Delete "${r.title}"?`)) void run(() => deleteResourceAction(r.id), "Material deleted."); }}>Delete</Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "quizzes" && (
        <div className="panel p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">{quiz ? (quiz.id ? "Edit quiz" : "New quiz") : "Quizzes"}</p>
            {!quiz && <Button size="sm" disabled={noClassesYet} onClick={newQuiz}>New quiz</Button>}
          </div>
          {quiz && (
            <div className="mb-4 flex flex-col gap-3">
              {frozen && (
                <p className="rounded-md border p-2 text-sm text-muted-foreground">
                  This quiz already has attempts, so its questions and class are locked. You can still rename it, change the attempt limit or answer review, or close it. To change the questions, close it and create a new quiz.
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="q-title">Title</Label>
                  <Input id="q-title" value={quiz.title} maxLength={150} onChange={(e) => setQuiz({ ...quiz, title: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="q-stream">Class</Label>
                  <select id="q-stream" className={selectClass} value={quiz.streamId} disabled={frozen} onChange={(e) => setQuiz({ ...quiz, streamId: e.target.value })}>
                    {streams.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <Label htmlFor="q-subject">Subject</Label>
                  <select id="q-subject" className={selectClass} value={quiz.subjectId} onChange={(e) => setQuiz({ ...quiz, subjectId: e.target.value })}>
                    {subjects.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="q-desc">Instructions (optional)</Label>
                  <Textarea id="q-desc" rows={2} maxLength={2000} value={quiz.description} onChange={(e) => setQuiz({ ...quiz, description: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="q-attempts">Attempts allowed</Label>
                  <Input id="q-attempts" type="number" min={1} max={10} value={quiz.maxAttempts} onChange={(e) => setQuiz({ ...quiz, maxAttempts: Number(e.target.value) })} />
                </div>
                <div>
                  <Label htmlFor="q-status">Status</Label>
                  <select id="q-status" className={selectClass} value={quiz.status} onChange={(e) => setQuiz({ ...quiz, status: e.target.value as QuizStatus })}>
                    {QUIZ_STATUSES.map((s) => <option key={s} value={s}>{QUIZ_STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" checked={quiz.showAnswers} onChange={(e) => setQuiz({ ...quiz, showAnswers: e.target.checked })} />
                  Show the correct answers to learners after they submit
                </label>
              </div>

              {quiz.questions && (
                <div className="flex flex-col gap-4">
                  {quiz.questions.map((q, n) => (
                    <fieldset key={n} className="rounded-md border p-3">
                      <legend className="px-1 text-xs font-medium text-muted-foreground">Question {n + 1}</legend>
                      <Label htmlFor={`qp-${n}`}>Question</Label>
                      <Textarea id={`qp-${n}`} rows={2} maxLength={1000} value={q.prompt} onChange={(e) => setQuestion(n, { prompt: e.target.value })} />
                      <div className="mt-2 flex flex-col gap-2">
                        {q.options.map((o, k) => (
                          <div key={k} className="flex items-center gap-2">
                            <input type="radio" name={`qc-${n}`} aria-label={`Option ${k + 1} is correct`} checked={q.correctIndex === k} onChange={() => setQuestion(n, { correctIndex: k })} />
                            <Input aria-label={`Question ${n + 1} option ${k + 1}`} value={o} maxLength={200} onChange={(e) => setQuestion(n, { options: q.options.map((x, i) => (i === k ? e.target.value : x)) })} />
                            {q.options.length > MIN_OPTIONS && (
                              <Button size="sm" variant="outline" onClick={() => setQuestion(n, { options: q.options.filter((_, i) => i !== k), correctIndex: q.correctIndex === k ? 0 : q.correctIndex > k ? q.correctIndex - 1 : q.correctIndex })}>Remove</Button>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {q.options.length < MAX_OPTIONS && <Button size="sm" variant="outline" onClick={() => setQuestion(n, { options: [...q.options, ""] })}>Add option</Button>}
                        <Label htmlFor={`qm-${n}`} className="ml-2">Marks</Label>
                        <Input id={`qm-${n}`} className="w-20" type="number" min={1} max={10} value={q.marks} onChange={(e) => setQuestion(n, { marks: Number(e.target.value) })} />
                        {quiz.questions!.length > 1 && (
                          <Button size="sm" variant="outline" onClick={() => setQuiz({ ...quiz, questions: quiz.questions!.filter((_, i) => i !== n) })}>Remove question</Button>
                        )}
                      </div>
                    </fieldset>
                  ))}
                  {quiz.questions.length < MAX_QUESTIONS && (
                    <div>
                      <Button size="sm" variant="outline" onClick={() => setQuiz({ ...quiz, questions: [...quiz.questions!, blankQuestion()] })}>Add question</Button>
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <Button disabled={busy} onClick={() => run(() => saveQuizAction(quiz), "Quiz saved.", () => setQuiz(null))}>{busy ? "Saving..." : "Save quiz"}</Button>
                <Button variant="outline" disabled={busy} onClick={() => setQuiz(null)}>Close</Button>
              </div>
            </div>
          )}
          {quizzes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No quizzes yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {quizzes.map((q) => {
                const stats = quizStats(attempts.filter((a) => a.quizId === q.id));
                return (
                  <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{q.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {label(streams, q.streamId)} · {label(subjects, q.subjectId)} · {q.questions.length} questions · {q.maxAttempts} {q.maxAttempts === 1 ? "attempt" : "attempts"}
                        {stats.attempts > 0 ? ` · ${stats.attempts} taken by ${stats.learners} learners, average ${stats.averagePercent}%` : " · not taken yet"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={quizTone(q.status)} label={QUIZ_STATUS_LABELS[q.status]} />
                      {q.editable && <Button size="sm" variant="outline" onClick={() => editQuiz(q)}>Edit</Button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
