"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Copy, Trash2, Check, Sparkles } from "lucide-react";
import {
  addSchemeEntry,
  updateSchemeEntry,
  deleteSchemeEntry,
  duplicateSchemeEntry,
  toggleEntryComplete,
  submitScheme,
  startSchemeReview,
  reviewScheme,
  assistSchemeEntry,
  type SchemeEntryInput,
} from "@/app/(app)/academics/scheme-of-work/actions";
import type { EntryAssistMode, EntryAssistDraft } from "@/lib/ai/scheme-of-work";
import type { SchemeDetailContext, SchemeEntryRow } from "@/app/(app)/academics/scheme-of-work/_types";
import { STATUS_LABELS } from "@/app/(app)/academics/scheme-of-work/_types";

const STATUS_TONE: Record<string, "neutral" | "info" | "warning" | "success"> = {
  draft: "neutral",
  in_progress: "info",
  submitted: "info",
  under_review: "warning",
  approved: "success",
};

type Scheme = NonNullable<SchemeDetailContext["scheme"]>;

const emptyForm = (schemeId: string, week: number, lesson: number): SchemeEntryInput => ({
  scheme_id: schemeId,
  week_number: week,
  lesson_number: lesson,
  entry_date: "",
  topic: "",
  subtopic: "",
  learning_outcomes: "",
  content: "",
  activities: "",
  teaching_methods: "",
  resources: "",
  assessment_methods: "",
  references: "",
  remarks: "",
});

export function SchemeEditor({
  scheme,
  entries,
  canEdit,
  canReview,
  canGenerateAI,
}: {
  scheme: Scheme;
  entries: SchemeEntryRow[];
  canEdit: boolean;
  canReview: boolean;
  canGenerateAI: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SchemeEntryInput>(emptyForm(scheme.id, 1, 1));

  const [assistPending, setAssistPending] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<EntryAssistDraft | null>(null);

  const totalEntries = entries.length;
  const completedEntries = entries.filter((e) => e.completion_status === "completed").length;
  const progressPct = totalEntries > 0 ? Math.round((completedEntries / totalEntries) * 100) : 0;

  const weeks = useMemo(() => {
    const byWeek = new Map<number, SchemeEntryRow[]>();
    for (const e of entries) {
      const list = byWeek.get(e.week_number) ?? [];
      list.push(e);
      byWeek.set(e.week_number, list);
    }
    for (const list of byWeek.values()) list.sort((a, b) => a.lesson_number - b.lesson_number);
    return Array.from(byWeek.entries()).sort((a, b) => a[0] - b[0]);
  }, [entries]);

  function openAdd(week: number) {
    const lessonsThisWeek = entries.filter((e) => e.week_number === week).length;
    setForm(emptyForm(scheme.id, week, Math.min(lessonsThisWeek + 1, scheme.lessons_per_week || 20)));
    setEditingId(null);
    setError(null);
    setAssistError(null);
    setSuggestion(null);
    setDialogOpen(true);
  }

  function openEdit(entry: SchemeEntryRow) {
    setForm({
      scheme_id: scheme.id,
      week_number: entry.week_number,
      lesson_number: entry.lesson_number,
      entry_date: entry.entry_date ?? "",
      topic: entry.topic,
      subtopic: entry.subtopic ?? "",
      learning_outcomes: entry.learning_outcomes ?? "",
      content: entry.content ?? "",
      activities: entry.activities ?? "",
      teaching_methods: entry.teaching_methods ?? "",
      resources: entry.resources ?? "",
      assessment_methods: entry.assessment_methods ?? "",
      references: entry.references ?? "",
      remarks: entry.remarks ?? "",
    });
    setEditingId(entry.id);
    setError(null);
    setAssistError(null);
    setSuggestion(null);
    setDialogOpen(true);
  }

  async function handleAssist(mode: EntryAssistMode) {
    if (!editingId) return;
    setAssistPending(true);
    setAssistError(null);
    const result = await assistSchemeEntry({ entry_id: editingId, mode, idempotency_key: crypto.randomUUID() });
    setAssistPending(false);
    if ("error" in result) return setAssistError(result.error);
    setSuggestion(result.suggestion);
  }

  function applySuggestion() {
    if (!suggestion) return;
    setForm({ ...form, ...suggestion });
    setSuggestion(null);
  }

  function discardSuggestion() {
    setSuggestion(null);
  }

  async function handleDialogSave() {
    setPending(true);
    setError(null);
    const result = editingId ? await updateSchemeEntry(editingId, form) : await addSchemeEntry(form);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setDialogOpen(false);
    setSuggestion(null);
    router.refresh();
  }

  async function handleDelete(entry: SchemeEntryRow) {
    if (!window.confirm(`Remove Week ${entry.week_number}, Lesson ${entry.lesson_number} — "${entry.topic}"?`)) return;
    setPending(true);
    const result = await deleteSchemeEntry(entry.id);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function handleDuplicate(entry: SchemeEntryRow) {
    const weekInput = window.prompt("Duplicate to which week?", String(entry.week_number));
    if (!weekInput) return;
    const lessonInput = window.prompt("Which lesson number in that week?", String(entry.lesson_number));
    if (!lessonInput) return;
    const week_number = Number(weekInput);
    const lesson_number = Number(lessonInput);
    if (!Number.isInteger(week_number) || !Number.isInteger(lesson_number)) return setError("Week and lesson must be numbers.");
    setPending(true);
    const result = await duplicateSchemeEntry(entry.id, { week_number, lesson_number });
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function handleToggleComplete(entry: SchemeEntryRow) {
    setPending(true);
    const result = await toggleEntryComplete(entry.id, entry.completion_status !== "completed");
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function handleSubmit() {
    if (!window.confirm("Submit this scheme for review? You can still be asked to revise it.")) return;
    setPending(true);
    const result = await submitScheme(scheme.id);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function handleStartReview() {
    setPending(true);
    const result = await startSchemeReview(scheme.id);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function handleReview(action: "approve" | "return") {
    let comment: string | null = null;
    if (action === "return") {
      comment = window.prompt("What needs to change before this can be approved?");
      if (!comment?.trim()) return;
    }
    setPending(true);
    const result = await reviewScheme(scheme.id, action, comment);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  const nextWeekNumber = (weeks[weeks.length - 1]?.[0] ?? 0) + 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">
            {scheme.subject_name} — {scheme.class_name} {scheme.stream_name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {scheme.term_label} · {scheme.teacher_name} · {scheme.total_weeks} weeks · {scheme.lessons_per_week} lessons/week
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={STATUS_TONE[scheme.status] ?? "neutral"} label={STATUS_LABELS[scheme.status] ?? scheme.status} />
        </div>
      </div>

      {scheme.review_comment && scheme.status === "draft" && (
        <div className="rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning">
          <p className="font-medium">Returned for revision</p>
          <p>{scheme.review_comment}</p>
        </div>
      )}

      <div className="panel flex items-center gap-3 p-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-success" style={{ width: `${progressPct}%` }} />
        </div>
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {completedEntries} / {totalEntries} lessons completed — {progressPct}%
        </span>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {canEdit && (scheme.status === "draft" || scheme.status === "in_progress") && (
          <Button type="button" variant="outline" disabled={pending || totalEntries === 0} onClick={handleSubmit}>
            Submit for Review
          </Button>
        )}
        {canReview && scheme.status === "submitted" && (
          <Button type="button" variant="outline" disabled={pending} onClick={handleStartReview}>
            Start Review
          </Button>
        )}
        {canReview && (scheme.status === "submitted" || scheme.status === "under_review") && (
          <>
            <Button type="button" disabled={pending} onClick={() => handleReview("approve")}>
              Approve
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => handleReview("return")}>
              Return for Revision
            </Button>
          </>
        )}
        {canEdit && (
          <Button type="button" variant="outline" size="sm" onClick={() => openAdd(nextWeekNumber)}>
            <Plus className="mr-1 size-4" aria-hidden /> Add Week {nextWeekNumber}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {weeks.length === 0 && (
          <p className="panel border-dashed p-8 text-center text-sm text-muted-foreground">
            No lessons yet. {canEdit && "Add the first one, or generate a draft with AI from the create screen."}
          </p>
        )}
        {weeks.map(([weekNumber, weekEntries]) => (
          <div key={weekNumber} className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
              <p className="text-sm font-semibold">Week {weekNumber}</p>
              {canEdit && (
                <Button type="button" variant="ghost" size="sm" onClick={() => openAdd(weekNumber)}>
                  <Plus className="mr-1 size-3.5" aria-hidden /> Add lesson
                </Button>
              )}
            </div>
            <div className="divide-y divide-border">
              {weekEntries.map((entry) => (
                <div key={entry.id} className="flex flex-col gap-1 p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        Lesson {entry.lesson_number}: {entry.topic}
                        {entry.subtopic ? ` — ${entry.subtopic}` : ""}
                        {entry.entry_date && (
                          <span className="ml-2 font-normal text-muted-foreground">
                            ({new Date(`${entry.entry_date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })})
                          </span>
                        )}
                      </p>
                      {entry.learning_outcomes && <p className="text-muted-foreground">Outcomes: {entry.learning_outcomes}</p>}
                      {entry.activities && <p className="text-muted-foreground">Activities: {entry.activities}</p>}
                      {entry.assessment_methods && <p className="text-muted-foreground">Assessment: {entry.assessment_methods}</p>}
                      {entry.references && <p className="text-muted-foreground">References: {entry.references}</p>}
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-1">
                        <Button type="button" variant="ghost" size="icon" title="Mark complete" disabled={pending} onClick={() => handleToggleComplete(entry)}>
                          <Check className={entry.completion_status === "completed" ? "size-4 text-success" : "size-4 text-muted-foreground"} aria-hidden />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" title="Edit" onClick={() => openEdit(entry)}>
                          <Pencil className="size-4" aria-hidden />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" title="Duplicate" disabled={pending} onClick={() => handleDuplicate(entry)}>
                          <Copy className="size-4" aria-hidden />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" title="Delete" disabled={pending} onClick={() => handleDelete(entry)}>
                          <Trash2 className="size-4 text-danger" aria-hidden />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Lesson" : "Add Lesson"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label>Week</Label>
              <Input type="number" min={1} value={form.week_number} onChange={(e) => setForm({ ...form, week_number: Number(e.target.value) })} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Lesson</Label>
              <Input type="number" min={1} value={form.lesson_number} onChange={(e) => setForm({ ...form, lesson_number: Number(e.target.value) })} />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <Label>Date (optional)</Label>
              <Input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <Label>Topic</Label>
              <Input value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <Label>Sub-topic</Label>
              <Input value={form.subtopic} onChange={(e) => setForm({ ...form, subtopic: e.target.value })} />
            </div>
            {canGenerateAI && editingId && (
              <div className="col-span-2 flex flex-col gap-2 rounded-md border border-dashed border-border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Sparkles className="size-4 text-muted-foreground" aria-hidden />
                  <span className="text-sm font-medium">AI Assist</span>
                  <div className="ml-auto flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={assistPending} onClick={() => handleAssist("improve")}>
                      {assistPending ? "Working…" : "Improve"}
                    </Button>
                    <Button type="button" variant="outline" size="sm" disabled={assistPending} onClick={() => handleAssist("expand")}>
                      {assistPending ? "Working…" : "Expand"}
                    </Button>
                    <Button type="button" variant="outline" size="sm" disabled={assistPending} onClick={() => handleAssist("generate_activities")}>
                      {assistPending ? "Working…" : "Generate Activities"}
                    </Button>
                  </div>
                </div>
                {assistError && <p className="text-sm text-danger">{assistError}</p>}
                {suggestion && (
                  <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-2">
                    <p className="text-xs font-medium text-muted-foreground">Suggestion — review before applying:</p>
                    <div className="flex flex-col gap-1 text-sm">
                      <p>
                        <span className="font-medium">Topic:</span> {suggestion.topic}
                      </p>
                      {suggestion.subtopic && (
                        <p>
                          <span className="font-medium">Sub-topic:</span> {suggestion.subtopic}
                        </p>
                      )}
                      {suggestion.learning_outcomes && (
                        <p>
                          <span className="font-medium">Learning outcomes:</span> {suggestion.learning_outcomes}
                        </p>
                      )}
                      {suggestion.content && (
                        <p>
                          <span className="font-medium">Content:</span> {suggestion.content}
                        </p>
                      )}
                      {suggestion.activities && (
                        <p>
                          <span className="font-medium">Activities:</span> {suggestion.activities}
                        </p>
                      )}
                      {suggestion.teaching_methods && (
                        <p>
                          <span className="font-medium">Teaching methods:</span> {suggestion.teaching_methods}
                        </p>
                      )}
                      {suggestion.resources && (
                        <p>
                          <span className="font-medium">Resources:</span> {suggestion.resources}
                        </p>
                      )}
                      {suggestion.assessment_methods && (
                        <p>
                          <span className="font-medium">Assessment:</span> {suggestion.assessment_methods}
                        </p>
                      )}
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={discardSuggestion}>
                        Discard
                      </Button>
                      <Button type="button" size="sm" onClick={applySuggestion}>
                        Apply to Form
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="col-span-2 flex flex-col gap-1">
              <Label>Learning outcomes</Label>
              <Textarea rows={2} value={form.learning_outcomes} onChange={(e) => setForm({ ...form, learning_outcomes: e.target.value })} />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <Label>Content</Label>
              <Textarea rows={2} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Learning activities</Label>
              <Textarea rows={2} value={form.activities} onChange={(e) => setForm({ ...form, activities: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Teaching methods</Label>
              <Textarea rows={2} value={form.teaching_methods} onChange={(e) => setForm({ ...form, teaching_methods: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Resources</Label>
              <Textarea rows={2} value={form.resources} onChange={(e) => setForm({ ...form, resources: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Assessment method</Label>
              <Textarea rows={2} value={form.assessment_methods} onChange={(e) => setForm({ ...form, assessment_methods: e.target.value })} />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <Label>References</Label>
              <Textarea rows={2} value={form.references} onChange={(e) => setForm({ ...form, references: e.target.value })} />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <Label>Remarks</Label>
              <Textarea rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </div>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={pending || !form.topic.trim()} onClick={handleDialogSave}>
              {pending ? "Saving…" : "Save Lesson"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
