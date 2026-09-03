"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  createCurriculumStrand,
  createCurriculumSubStrand,
  updateCurriculumSubStrandContent,
  submitCompetencyMarks,
  editCompetencyMark,
  uploadCompetencyEvidenceAction,
  deleteCompetencyEvidenceAction,
  listCompetencyEvidenceAction,
  getCompetencyEvidenceUrlAction,
} from "@/app/(app)/exams/actions";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { queueMutation } from "@/lib/offline/queue";
import { ExamsOfflineBanner } from "./offline-banner";

export interface StrandOption {
  id: string;
  name: string;
  sub_strands: {
    id: string;
    name: string;
    learning_outcomes: string | null;
    key_inquiry_questions: string | null;
    rubric_text: string | null;
    content_source: "school_authored" | "kicd_licensed" | "draft";
  }[];
}

export interface CompetencyRatingRow {
  id: string;
  student_id: string;
  sub_strand_id: string;
  band_id: string;
}

export interface CompetencyRosterRow {
  student_id: string;
  full_name: string;
}

interface EvidenceItem {
  id: string;
  file_name: string;
  storage_path: string;
  created_at: string;
}

interface Props {
  examId: string;
  classId: string;
  subjectId: string;
  strands: StrandOption[];
  bandOptions: { id: string; label: string }[];
  roster: CompetencyRosterRow[];
  existingRatings: CompetencyRatingRow[];
  examStatus: "open" | "closed";
  canEnter: boolean;
  canManageCurriculum: boolean;
}

/**
 * Small inline panel for one saved competency_marks rating -- lists/uploads/
 * deletes evidence files. Only rendered for ratings that already have a real
 * DB row (a competency_mark_id to attach evidence to) -- evidence cannot be
 * attached to an unsaved cell. Kept self-contained so the parent grid
 * doesn't need to track evidence state for every cell up front.
 */
function EvidenceButton({ competencyMarkId, canEnter }: { competencyMarkId: string; canEnter: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<EvidenceItem[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function load() {
    startTransition(async () => {
      const result = await listCompetencyEvidenceAction(competencyMarkId);
      if ("error" in result) return setError(result.error);
      setItems(result.items);
    });
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && items === null) load();
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    startTransition(async () => {
      const result = await uploadCompetencyEvidenceAction(competencyMarkId, formData);
      if ("error" in result) return setError(result.error);
      load();
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteCompetencyEvidenceAction(id);
      if ("error" in result) return setError(result.error);
      load();
    });
  }

  function handleView(storagePath: string) {
    startTransition(async () => {
      const result = await getCompetencyEvidenceUrlAction(storagePath);
      if ("error" in result) return setError(result.error);
      window.open(result.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={toggle}
        className="text-[0.625rem] text-muted-foreground underline decoration-dotted hover:text-foreground"
      >
        {open ? "Hide evidence" : "Evidence"}
        {items && items.length > 0 ? ` (${items.length})` : ""}
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-1 rounded-sm border border-border bg-muted/30 p-2">
          {error && <p className="text-[0.625rem] text-danger">{error}</p>}
          {items === null ? (
            <p className="text-[0.625rem] text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-[0.625rem] text-muted-foreground">No evidence attached.</p>
          ) : (
            items.map((it) => (
              <div key={it.id} className="flex items-center justify-between gap-2 text-[0.625rem]">
                <button
                  type="button"
                  className="truncate text-left underline decoration-dotted hover:text-foreground"
                  onClick={() => handleView(it.storage_path)}
                  title={it.file_name}
                >
                  {it.file_name}
                </button>
                {canEnter && (
                  <button
                    type="button"
                    className="shrink-0 text-danger hover:underline"
                    disabled={pending}
                    onClick={() => handleDelete(it.id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))
          )}
          {canEnter && (
            <label className="mt-1 cursor-pointer text-[0.625rem] text-primary underline decoration-dotted hover:no-underline">
              {pending ? "Working…" : "Attach file"}
              <input type="file" className="hidden" disabled={pending} onChange={handleUpload} />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * KICD curriculum content editor (CBC/CBE investigation, roadmap Item 1) --
 * a plain text-field save for a sub-strand's learning outcomes / key inquiry
 * questions / rubric text. Never fetches or generates this content itself --
 * the person managing curriculum types or pastes it in. content_source
 * defaults to 'draft' the first time real content is saved here, so it never
 * silently reads as confirmed-licensed KICD text -- 'kicd_licensed' has to
 * be picked deliberately, once reuse is actually confirmed permitted.
 */
function SubStrandContentEditor({
  subStrand,
}: {
  subStrand: {
    id: string;
    name: string;
    learning_outcomes: string | null;
    key_inquiry_questions: string | null;
    rubric_text: string | null;
    content_source: "school_authored" | "kicd_licensed" | "draft";
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [learningOutcomes, setLearningOutcomes] = useState(subStrand.learning_outcomes ?? "");
  const [keyInquiryQuestions, setKeyInquiryQuestions] = useState(subStrand.key_inquiry_questions ?? "");
  const [rubricText, setRubricText] = useState(subStrand.rubric_text ?? "");
  const [contentSource, setContentSource] = useState(subStrand.content_source);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateCurriculumSubStrandContent({
        sub_strand_id: subStrand.id,
        learning_outcomes: learningOutcomes.trim() || null,
        key_inquiry_questions: keyInquiryQuestions.trim() || null,
        rubric_text: rubricText.trim() || null,
        content_source: contentSource,
      });
      if ("error" in result) return setError(result.error);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="pl-8">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-muted-foreground underline decoration-dotted hover:text-foreground"
      >
        {subStrand.name} — {open ? "hide content" : "edit content"}
        {subStrand.content_source !== "school_authored" && ` (${subStrand.content_source})`}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2 rounded-md border border-border bg-background p-3">
          {error && <p className="text-xs text-danger">{error}</p>}
          <label className="text-xs font-medium text-muted-foreground">
            Learning outcomes
            <Textarea value={learningOutcomes} onChange={(e) => setLearningOutcomes(e.target.value)} rows={3} className="mt-1" />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Key inquiry questions
            <Textarea value={keyInquiryQuestions} onChange={(e) => setKeyInquiryQuestions(e.target.value)} rows={2} className="mt-1" />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Rubric text (what each competency level looks like)
            <Textarea value={rubricText} onChange={(e) => setRubricText(e.target.value)} rows={3} className="mt-1" />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Content source
            <Select value={contentSource} onValueChange={(v) => setContentSource(v as typeof contentSource)}>
              <SelectTrigger className="mt-1 w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="school_authored">School-authored (written by us)</SelectItem>
                <SelectItem value="draft">Draft (KICD-style, not yet confirmed licensed)</SelectItem>
                <SelectItem value="kicd_licensed">KICD-licensed (reuse confirmed permitted)</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <Button size="sm" disabled={pending} onClick={handleSave} className="w-fit">
            {pending ? "Saving…" : "Save content"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function CompetencyMarksSection({
  examId,
  classId,
  strands,
  bandOptions,
  roster,
  existingRatings,
  examStatus,
  canEnter,
  canManageCurriculum,
  subjectId,
}: Props) {
  const router = useRouter();
  const { online, pendingCount, failed, syncing, sync, discard } = useOfflineSync("exams");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Map<string, string>>(
    new Map(existingRatings.map((r) => [`${r.student_id}:${r.sub_strand_id}`, r.band_id])),
  );
  // Maps the same "student:sub_strand" key to the saved row's real id, so
  // evidence can be attached to it. Only present for ratings that already
  // exist in the database -- a freshly-typed, not-yet-saved cell has no id
  // yet and therefore shows no evidence control until after a save+refresh.
  const savedRatingIds = new Map(existingRatings.map((r) => [`${r.student_id}:${r.sub_strand_id}`, r.id]));
  // Ratings queued while offline, keyed the same way as `ratings` -- kept
  // separate so they render distinctly and aren't re-submitted before the
  // sync confirms them. Mirrors marks-entry-form.tsx.
  const [queued, setQueued] = useState<Map<string, string>>(new Map());
  const [newStrandName, setNewStrandName] = useState("");
  const [newSubStrand, setNewSubStrand] = useState<Record<string, string>>({});

  const subStrandList = strands.flatMap((s) => s.sub_strands.map((ss) => ({ ...ss, strandName: s.name })));

  function setRating(studentId: string, subStrandId: string, bandId: string) {
    setRatings((prev) => new Map(prev).set(`${studentId}:${subStrandId}`, bandId));
  }

  function handleSave() {
    setError(null);
    const existingKeys = new Set(existingRatings.map((r) => `${r.student_id}:${r.sub_strand_id}`));
    const toSubmit: { student_id: string; sub_strand_id: string; band_id: string }[] = [];
    const toEdit: { student_id: string; sub_strand_id: string; band_id: string }[] = [];

    for (const [key, band_id] of ratings.entries()) {
      if (queued.has(key)) continue; // already queued offline, not re-submitted
      const [student_id, sub_strand_id] = key.split(":");
      if (examStatus === "closed" && existingKeys.has(key)) {
        toEdit.push({ student_id, sub_strand_id, band_id });
      } else {
        toSubmit.push({ student_id, sub_strand_id, band_id });
      }
    }

    if (!online) {
      // Corrections to a closed exam need a live connection, same as
      // editMark elsewhere -- only fresh ratings can be queued.
      if (toEdit.length > 0) {
        setError("You're offline. Corrections to a closed exam need a connection — new ratings below were still saved offline.");
      }
      if (toSubmit.length === 0) return;
      startTransition(async () => {
        try {
          await queueMutation("exams", "submitCompetencyMarks", { exam_id: examId, class_id: classId, ratings: toSubmit });
          setQueued((prev) => {
            const next = new Map(prev);
            for (const r of toSubmit) next.set(`${r.student_id}:${r.sub_strand_id}`, r.band_id);
            return next;
          });
        } catch {
          setError("Couldn't save offline either — try again in a moment.");
        }
      });
      return;
    }

    startTransition(async () => {
      if (toSubmit.length > 0) {
        const result = await submitCompetencyMarks({ exam_id: examId, class_id: classId, ratings: toSubmit });
        if ("error" in result) return setError(result.error);
      }
      for (const r of toEdit) {
        const reason = window.prompt(`Reason for editing this closed-exam rating?`);
        if (!reason) continue;
        const result = await editCompetencyMark({
          exam_id: examId,
          student_id: r.student_id,
          sub_strand_id: r.sub_strand_id,
          band_id: r.band_id,
          edit_reason: reason,
        });
        if ("error" in result) return setError(result.error);
      }
      router.refresh();
    });
  }

  function handleAddStrand() {
    if (!newStrandName.trim()) return;
    startTransition(async () => {
      const result = await createCurriculumStrand({ subject_id: subjectId, name: newStrandName.trim() });
      if ("error" in result) return setError(result.error);
      setNewStrandName("");
      router.refresh();
    });
  }

  function handleAddSubStrand(strandId: string) {
    const name = (newSubStrand[strandId] ?? "").trim();
    if (!name) return;
    startTransition(async () => {
      const result = await createCurriculumSubStrand({ strand_id: strandId, name });
      if ("error" in result) return setError(result.error);
      setNewSubStrand((prev) => ({ ...prev, [strandId]: "" }));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold">Competency marks (by sub-strand)</h2>
        <p className="text-sm text-muted-foreground">
          CBC assessment at the sub-strand level — a rating per student per sub-strand, separate from the
          overall subject-level competency above. Once a rating is saved, evidence (a photo, recording, or work
          sample) can be attached to it below the rating.
        </p>
      </div>
      <ExamsOfflineBanner online={online} pendingCount={pendingCount} failed={failed} syncing={syncing} sync={sync} discard={discard} />
      {error && <p className="text-sm text-danger">{error}</p>}

      {canManageCurriculum && (
        <div className="flex flex-col gap-3 rounded-md bg-muted/30 p-3">
          <div className="flex items-end gap-2">
            <Input
              placeholder="New strand name (e.g. Listening and Speaking)"
              value={newStrandName}
              onChange={(e) => setNewStrandName(e.target.value)}
              className="max-w-sm"
            />
            <Button size="sm" variant="outline" disabled={pending} onClick={handleAddStrand}>
              Add strand
            </Button>
          </div>
          {strands.map((s) => (
            <div key={s.id} className="flex flex-col gap-2 pl-4">
              <div className="flex items-end gap-2">
                <span className="text-sm text-muted-foreground">{s.name} →</span>
                <Input
                  placeholder="New sub-strand name"
                  value={newSubStrand[s.id] ?? ""}
                  onChange={(e) => setNewSubStrand((prev) => ({ ...prev, [s.id]: e.target.value }))}
                  className="max-w-xs"
                />
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleAddSubStrand(s.id)}>
                  Add sub-strand
                </Button>
              </div>
              {s.sub_strands.map((ss) => (
                <SubStrandContentEditor key={ss.id} subStrand={ss} />
              ))}
            </div>
          ))}
        </div>
      )}

      {subStrandList.length === 0 ? (
        <div className="panel border-dashed p-6 text-center text-sm text-muted-foreground">
          No strands/sub-strands defined for this subject yet.
        </div>
      ) : (
        <>
          <div className="panel overflow-x-auto">
            <Table className="table-dense">
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  {subStrandList.map((ss) => (
                    <TableHead key={ss.id}>
                      {ss.strandName} — {ss.name}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.map((r) => (
                  <TableRow key={r.student_id}>
                    <TableCell className="font-medium">{r.full_name}</TableCell>
                    {subStrandList.map((ss) => {
                      const key = `${r.student_id}:${ss.id}`;
                      const isQueued = queued.has(key);
                      const savedId = savedRatingIds.get(key);
                      return (
                        <TableCell key={ss.id}>
                          <Select
                            value={ratings.get(key) ?? ""}
                            onValueChange={(v) => setRating(r.student_id, ss.id, v)}
                            disabled={!canEnter || isQueued}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue placeholder="—" />
                            </SelectTrigger>
                            <SelectContent>
                              {bandOptions.map((b) => (
                                <SelectItem key={b.id} value={b.id}>
                                  {b.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {isQueued && <p className="mt-1 text-[0.625rem] text-muted-foreground">Saved offline</p>}
                          {savedId && <EvidenceButton competencyMarkId={savedId} canEnter={canEnter} />}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
            </TableBody>
            </Table>
          </div>
          {canEnter && (
            <Button disabled={pending} onClick={handleSave} className="mt-3 w-fit">
              {pending ? (online ? "Saving…" : "Saving offline…") : online ? "Save competency marks" : "Save offline"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
