"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Sparkles, TriangleAlert } from "lucide-react";
import { generateSchemeWithAI, saveGeneratedScheme, createManualScheme } from "@/app/(app)/academics/scheme-of-work/actions";
import type { CreateSchemeOptions } from "@/app/(app)/academics/scheme-of-work/_types";
import type { SchemeOfWorkDraft } from "@/lib/ai/scheme-of-work";

const NONE = "__none__";

export function SchemeCreateForm({ options }: { options: CreateSchemeOptions }) {
  const router = useRouter();

  const [academicYearId, setAcademicYearId] = useState("");
  const [termId, setTermId] = useState("");
  const [classId, setClassId] = useState("");
  const [streamId, setStreamId] = useState<string>("");
  const [subjectId, setSubjectId] = useState("");
  const [totalWeeks, setTotalWeeks] = useState(13);
  const [lessonsPerWeek, setLessonsPerWeek] = useState(4);
  const [curriculumFramework, setCurriculumFramework] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [manualPending, setManualPending] = useState(false);
  const [aiPending, setAiPending] = useState(false);
  const [savePending, setSavePending] = useState(false);

  const [draft, setDraft] = useState<SchemeOfWorkDraft | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [partial, setPartial] = useState(false);
  const [weeksGenerated, setWeeksGenerated] = useState(0);
  const [requestId, setRequestId] = useState<string | null>(null);

  const streamsForClass = options.streamOptions.filter((s) => s.class_id === classId);
  const ready = academicYearId && termId && classId && subjectId && totalWeeks > 0 && lessonsPerWeek > 0;

  function applyAssignment(a: CreateSchemeOptions["assignments"][number]) {
    setClassId(a.class_id);
    setStreamId(a.stream_id);
    setSubjectId(a.subject_id);
    if (a.lessons_per_week) setLessonsPerWeek(a.lessons_per_week);
    setError(null);
  }

  async function handleManualCreate() {
    setError(null);
    setManualPending(true);
    const result = await createManualScheme({
      academic_year_id: academicYearId,
      term_id: termId,
      class_id: classId,
      stream_id: streamId || null,
      subject_id: subjectId,
      total_weeks: totalWeeks,
      lessons_per_week: lessonsPerWeek,
    });
    setManualPending(false);
    if ("error" in result) return setError(result.error);
    router.push(`/academics/scheme-of-work/${result.schemeId}`);
  }

  async function handleGenerate() {
    if (draft && !window.confirm("Generating a new draft will replace the preview currently shown (nothing saved yet is affected). Continue?")) {
      return;
    }
    setError(null);
    setAiPending(true);
    const result = await generateSchemeWithAI({
      academic_year_id: academicYearId,
      term_id: termId,
      class_id: classId,
      stream_id: streamId || null,
      subject_id: subjectId,
      total_weeks: totalWeeks,
      lessons_per_week: lessonsPerWeek,
      curriculum_framework: curriculumFramework.trim() || null,
      idempotency_key: crypto.randomUUID(),
    });
    setAiPending(false);
    if ("error" in result) return setError(result.error);
    setDraft(result.draft);
    setWarnings(result.warnings);
    setPartial(result.partial);
    setWeeksGenerated(result.weeksGenerated);
    setRequestId(result.requestId || null);
  }

  async function handleSaveDraft() {
    if (!draft) return;
    setError(null);
    setSavePending(true);
    const result = await saveGeneratedScheme({
      request_id: requestId,
      academic_year_id: academicYearId,
      term_id: termId,
      class_id: classId,
      stream_id: streamId || null,
      subject_id: subjectId,
      total_weeks: totalWeeks,
      lessons_per_week: lessonsPerWeek,
      weeks: draft.weeks,
    });
    setSavePending(false);
    if ("error" in result) return setError(result.error);
    router.push(`/academics/scheme-of-work/${result.schemeId}`);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold">New Scheme of Work</h1>
        <p className="text-sm text-muted-foreground">Select the basics, then create it manually or generate a first draft with AI.</p>
      </div>

      {options.assignments.length > 0 && (
        <div className="panel flex flex-col gap-2 p-3">
          <p className="text-sm font-medium">Your teaching assignments</p>
          <div className="flex flex-wrap gap-2">
            {options.assignments.map((a) => (
              <Button
                key={`${a.stream_id}:${a.subject_id}`}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyAssignment(a)}
              >
                {a.subject_name} — {a.class_name} {a.stream_name}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="panel grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label>Academic Year</Label>
          <Select value={academicYearId} onValueChange={setAcademicYearId}>
            <SelectTrigger>
              <SelectValue placeholder="Select year" />
            </SelectTrigger>
            <SelectContent>
              {options.yearOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Term</Label>
          <Select value={termId} onValueChange={setTermId}>
            <SelectTrigger>
              <SelectValue placeholder="Select term" />
            </SelectTrigger>
            <SelectContent>
              {options.termOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Class</Label>
          <Select
            value={classId}
            onValueChange={(v) => {
              setClassId(v);
              setStreamId("");
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select class" />
            </SelectTrigger>
            <SelectContent>
              {options.classOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Stream (optional)</Label>
          <Select value={streamId || NONE} onValueChange={(v) => setStreamId(v === NONE ? "" : v)} disabled={!classId}>
            <SelectTrigger>
              <SelectValue placeholder="Whole class" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Whole class (no stream)</SelectItem>
              {streamsForClass.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Subject</Label>
          <Select value={subjectId} onValueChange={setSubjectId}>
            <SelectTrigger>
              <SelectValue placeholder="Select subject" />
            </SelectTrigger>
            <SelectContent>
              {options.subjectOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Curriculum framework (optional)</Label>
          <Input value={curriculumFramework} onChange={(e) => setCurriculumFramework(e.target.value)} placeholder="e.g. CBC" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Teaching weeks</Label>
          <Input
            type="number"
            min={1}
            max={52}
            value={totalWeeks}
            onChange={(e) => setTotalWeeks(Number(e.target.value))}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Lessons per week</Label>
          <Input
            type="number"
            min={1}
            max={20}
            value={lessonsPerWeek}
            onChange={(e) => setLessonsPerWeek(Number(e.target.value))}
          />
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={!ready || manualPending} onClick={handleManualCreate}>
          {manualPending ? "Creating…" : "Create Scheme (manual)"}
        </Button>
        {options.canGenerateAI && (
          <Button type="button" disabled={!ready || aiPending} onClick={handleGenerate}>
            <Sparkles className="mr-1.5 size-4" aria-hidden />
            {aiPending ? "Generating…" : draft ? "Regenerate with AI" : "Generate with AI"}
          </Button>
        )}
      </div>

      {draft && (
        <div className="panel flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              <Sparkles className="mr-1.5 inline size-4 text-primary" aria-hidden />
              AI-generated draft — please review before saving
            </p>
            <span className="text-sm text-muted-foreground">
              {weeksGenerated} of {totalWeeks} weeks
            </span>
          </div>

          {partial && (
            <p className="flex items-start gap-2 rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              The generated scheme is incomplete. We prepared only {weeksGenerated} of the requested {totalWeeks} weeks. You can
              save what was generated and add the rest manually, or regenerate.
            </p>
          )}

          {warnings.length > 0 && (
            <div className="rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning">
              <p className="font-medium">Please review the generated scheme</p>
              <ul className="ml-4 mt-1 list-disc">
                {warnings.slice(0, 8).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {warnings.length > 8 && <li>…and {warnings.length - 8} more.</li>}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {draft.weeks.map((week) => (
              <details key={week.week} className="rounded-md border border-border">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                  Week {week.week} — {week.entries[0]?.topic ?? "(no topic)"}
                  {week.entries.length > 1 ? ` +${week.entries.length - 1} more lesson(s)` : ""}
                </summary>
                <div className="flex flex-col gap-2 border-t border-border p-3">
                  {week.entries.map((entry, i) => (
                    <div key={i} className="rounded-md bg-muted/30 p-2 text-sm">
                      <p className="font-medium">
                        Lesson {entry.lesson}: {entry.topic}
                        {entry.subtopic ? ` — ${entry.subtopic}` : ""}
                      </p>
                      {entry.learning_outcomes && <p className="text-muted-foreground">Outcomes: {entry.learning_outcomes}</p>}
                      {entry.activities && <p className="text-muted-foreground">Activities: {entry.activities}</p>}
                      {entry.assessment && <p className="text-muted-foreground">Assessment: {entry.assessment}</p>}
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            This is a draft. Saving will open the full editor where you can change anything before submitting it for review.
          </p>
          <div className="flex gap-2">
            <Button type="button" disabled={savePending} onClick={handleSaveDraft}>
              {savePending ? "Saving…" : "Save Scheme"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setDraft(null)}>
              Discard draft
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
