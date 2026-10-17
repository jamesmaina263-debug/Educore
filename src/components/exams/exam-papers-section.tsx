"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/status-badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  generateExamPaper,
  getExamPaperSourceOptions,
  updateExamPaperQuestion,
  deleteExamPaperQuestion,
  setExamPaperStatus,
  deleteExamPaper,
  type SourceOptionSummary,
} from "@/app/(app)/exams/papers/actions";
import { EXAM_QUESTION_TYPES, EXAM_SOURCE_LABELS, type ExamQuestionType } from "@/lib/ai/exam-paper";
import type { PaperRow } from "@/app/(app)/exams/papers/_data";

const TYPE_LABELS: Record<ExamQuestionType, string> = {
  multiple_choice: "Multiple choice",
  short_answer: "Short answer",
  structured: "Structured",
  essay: "Essay",
};

function optionKey(o: { kind: string; sourceId: string | null }) {
  return `${o.kind}:${o.sourceId ?? "own"}`;
}

export function ExamPapersSection({
  canGenerate,
  classes,
  subjects,
  openExams,
  papers,
}: {
  canGenerate: boolean;
  classes: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
  openExams: { id: string; name: string }[];
  papers: PaperRow[];
}) {
  const router = useRouter();
  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [options, setOptions] = useState<SourceOptionSummary[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [loadingOptions, startLoadOptions] = useTransition();
  const [chosenKey, setChosenKey] = useState("");
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [totalMarks, setTotalMarks] = useState("50");
  const [questionCount, setQuestionCount] = useState("10");
  const [types, setTypes] = useState<Set<ExamQuestionType>>(new Set(["short_answer", "structured"]));
  const [teacherNotes, setTeacherNotes] = useState("");
  const [examId, setExamId] = useState("none");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Changing class or subject invalidates the loaded sources and selection.
  function resetSources() {
    setOptions(null);
    setChosenKey("");
    setSelectedRefs(new Set());
    setOptionsError(null);
  }

  useEffect(() => {
    if (!classId || !subjectId || !canGenerate) return;
    startLoadOptions(async () => {
      const result = await getExamPaperSourceOptions(classId, subjectId);
      if ("error" in result) {
        setOptionsError(result.error);
        return;
      }
      setOptions(result.options);
      setNotes(result.notes);
      // Only auto-pick when there is exactly one source: never choose between sources on the teacher's behalf.
      if (result.options.length === 1) setChosenKey(optionKey(result.options[0]));
    });
  }, [classId, subjectId, canGenerate]);

  const chosen = options?.find((o) => optionKey(o) === chosenKey) ?? null;

  function toggleRef(ref: string) {
    setSelectedRefs((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  }

  function toggleType(t: ExamQuestionType) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  async function handleGenerate() {
    if (!chosen) return;
    setPending(true);
    setError(null);
    setWarnings([]);
    const result = await generateExamPaper({
      class_id: classId,
      subject_id: subjectId,
      source_kind: chosen.kind,
      source_id: chosen.sourceId,
      sub_strand_refs: Array.from(selectedRefs),
      title,
      total_marks: Number(totalMarks),
      question_count: Number(questionCount),
      question_types: Array.from(types),
      teacher_notes: teacherNotes.trim() || null,
      exam_id: examId === "none" ? null : examId,
      idempotency_key: crypto.randomUUID(),
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setWarnings(result.warnings);
    setTitle("");
    setSelectedRefs(new Set());
    router.refresh();
  }

  if (!canGenerate && papers.length === 0) {
    return <p className="text-sm text-muted-foreground">You don&apos;t have access to exam papers.</p>;
  }

  const canSubmit = !pending && chosen && selectedRefs.size > 0 && title.trim() && types.size > 0;

  return (
    <div className="flex flex-col gap-4">
      {canGenerate && (
        <div className="panel space-y-4 p-4">
          <h2 className="text-[0.8125rem] font-semibold">Generate a draft paper</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Class</Label>
              <Select
                value={classId}
                onValueChange={(v) => {
                  resetSources();
                  setClassId(v);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select class" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Select
                value={subjectId}
                onValueChange={(v) => {
                  resetSources();
                  setSubjectId(v);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {loadingOptions && <p className="text-sm text-muted-foreground">Loading curriculum sources…</p>}
          {optionsError && <p className="text-sm text-danger">{optionsError}</p>}
          {options && notes.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {options && options.length === 0 && (
            <p className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              No curriculum content is available for this class and subject, so a paper can&apos;t be generated. Add curriculum content under Academics &gt; Curriculum first.
            </p>
          )}

          {options && options.length > 0 && (
            <div className="space-y-2">
              <Label>Curriculum source (one source per paper — sources are never mixed)</Label>
              <div className="space-y-2">
                {options.map((o) => (
                  <label key={optionKey(o)} className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-sm">
                    <input
                      type="radio"
                      name="source"
                      className="mt-1"
                      checked={chosenKey === optionKey(o)}
                      onChange={() => {
                        setChosenKey(optionKey(o));
                        setSelectedRefs(new Set());
                      }}
                    />
                    <span>
                      <span className="font-medium">{o.label}</span> — {o.name}
                      {o.licenceReference && <span className="block text-xs text-muted-foreground">Licence: {o.licenceReference}</span>}
                      {o.attribution && <span className="block text-xs text-muted-foreground">{o.attribution}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {chosen && (
            <div className="space-y-1.5">
              <Label>Sub-strands to examine ({selectedRefs.size} selected)</Label>
              <div className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-md border border-border p-3">
                {chosen.subStrands.map((s) => (
                  <div key={s.ref} className="flex items-start gap-2">
                    <Checkbox id={`ss-${s.ref}`} disabled={!s.usable} checked={selectedRefs.has(s.ref)} onCheckedChange={() => toggleRef(s.ref)} />
                    <Label htmlFor={`ss-${s.ref}`} className="flex-1 font-normal">
                      <span className="text-muted-foreground">{s.strand} › </span>
                      {s.name}
                      {!s.usable && <span className="block text-xs text-warning">Not available: {s.unusableReason}</span>}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {chosen && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1.5 sm:col-span-3">
                  <Label>Paper title</Label>
                  <Input placeholder="Term 2 Mid-term — Science" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Total marks</Label>
                  <Input type="number" value={totalMarks} onChange={(e) => setTotalMarks(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Number of questions</Label>
                  <Input type="number" value={questionCount} onChange={(e) => setQuestionCount(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Link to exam (optional)</Label>
                  <Select value={examId} onValueChange={setExamId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not linked</SelectItem>
                      {openExams.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Question types</Label>
                <div className="flex flex-wrap gap-3">
                  {EXAM_QUESTION_TYPES.map((t) => (
                    <div key={t} className="flex items-center gap-1.5">
                      <Checkbox id={`type-${t}`} checked={types.has(t)} onCheckedChange={() => toggleType(t)} />
                      <Label htmlFor={`type-${t}`} className="font-normal">
                        {TYPE_LABELS[t]}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Notes for the AI (optional, style and difficulty only)</Label>
                <Textarea rows={2} maxLength={500} value={teacherNotes} onChange={(e) => setTeacherNotes(e.target.value)} />
              </div>
            </>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}
          {warnings.length > 0 && (
            <ul className="space-y-1 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <Button onClick={handleGenerate} disabled={!canSubmit}>
            {pending ? "Generating…" : "Generate draft paper"}
          </Button>
        </div>
      )}

      {papers.length === 0 ? (
        <div className="panel border-dashed p-6 text-center text-sm text-muted-foreground">No exam papers yet.</div>
      ) : (
        papers.map((p) => <PaperCard key={p.id} paper={p} />)
      )}
    </div>
  );
}

function PaperCard({ paper }: { paper: PaperRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ question_text: "", marks: "", marking_scheme: "" });
  const isDraft = paper.status === "draft";

  async function run(fn: () => Promise<{ success: true } | { error: string }>) {
    setBusy(true);
    setError(null);
    const result = await fn();
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setEditingId(null);
    router.refresh();
  }

  return (
    <div className="panel">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div>
          <h2 className="text-[0.8125rem] font-semibold">{paper.title}</h2>
          <p className="text-[0.6875rem] text-muted-foreground">
            {paper.class_name} · {paper.subject_name} · {paper.total_marks} marks · {paper.questions.length} questions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={isDraft ? "neutral" : "success"} label={paper.status} />
          <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide" : "View"}
          </Button>
        </div>
      </header>
      <div className="space-y-1 px-4 py-2 text-xs text-muted-foreground">
        <p>
          Source: {EXAM_SOURCE_LABELS[paper.source_kind]} — {paper.source_name}
        </p>
        {paper.source_licence_reference && <p>Licence: {paper.source_licence_reference}</p>}
        {paper.source_attribution && <p>{paper.source_attribution}</p>}
        {isDraft && <p>Draft for teacher review — not official KICD or KNEC material.</p>}
      </div>
      {open && (
        <div className="space-y-3 border-t border-border p-4">
          {paper.questions.map((q) => (
            <div key={q.id} className="space-y-1.5 rounded-md border border-border p-3 text-sm">
              <p className="text-xs text-muted-foreground">
                Q{q.position} · {TYPE_LABELS[q.question_type as ExamQuestionType] ?? q.question_type} · {q.marks} marks · {q.sub_strand_label}
              </p>
              {editingId === q.id ? (
                <div className="space-y-2">
                  <Textarea rows={4} value={draft.question_text} onChange={(e) => setDraft((d) => ({ ...d, question_text: e.target.value }))} />
                  <Input className="w-28" type="number" value={draft.marks} onChange={(e) => setDraft((d) => ({ ...d, marks: e.target.value }))} />
                  <Textarea rows={3} value={draft.marking_scheme} onChange={(e) => setDraft((d) => ({ ...d, marking_scheme: e.target.value }))} />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => run(() => updateExamPaperQuestion(q.id, { question_text: draft.question_text, marks: Number(draft.marks), marking_scheme: draft.marking_scheme }))}
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap">{q.question_text}</p>
                  <p className="whitespace-pre-wrap text-xs text-muted-foreground">Marking scheme: {q.marking_scheme}</p>
                  {isDraft && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingId(q.id);
                          setDraft({ question_text: q.question_text, marks: String(q.marks), marking_scheme: q.marking_scheme });
                        }}
                      >
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => deleteExamPaperQuestion(q.id))}>
                        Remove
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {isDraft ? (
              <Button size="sm" disabled={busy} onClick={() => run(() => setExamPaperStatus(paper.id, "approved"))}>
                Approve paper
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => setExamPaperStatus(paper.id, "draft"))}>
                Reopen as draft
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => deleteExamPaper(paper.id))}>
              Delete paper
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
