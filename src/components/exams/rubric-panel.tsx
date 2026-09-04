"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  createRubric,
  addRubricCriterion,
  updateRubricCriterion,
  deleteRubricCriterion,
  saveRubricLevelDescriptor,
  saveRubricCriterionScore,
  listRubricCriterionScores,
  type RubricDetail,
} from "@/app/(app)/exams/rubric-actions";

interface BandOption {
  id: string;
  label: string;
}

/**
 * Curriculum-management panel: define/edit a structured rubric (criteria x
 * performance-level descriptors) for one sub-strand. Additive alongside the
 * plain rubric_text field in SubStrandContentEditor -- a school can use
 * either or both. Only rendered where canManageCurriculum is already true,
 * same gate as the rest of the curriculum section.
 */
export function RubricEditor({
  subStrandId,
  rubric,
  bandOptions,
}: {
  subStrandId: string;
  rubric: RubricDetail | null;
  bandOptions: BandOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newCriterionName, setNewCriterionName] = useState("");

  function handleCreateRubric() {
    startTransition(async () => {
      const result = await createRubric({ sub_strand_id: subStrandId });
      if ("error" in result) return setError(result.error);
      router.refresh();
    });
  }

  function handleAddCriterion() {
    if (!rubric || !newCriterionName.trim()) return;
    startTransition(async () => {
      const result = await addRubricCriterion({
        rubric_id: rubric.id,
        name: newCriterionName.trim(),
        display_order: rubric.criteria.length,
      });
      if ("error" in result) return setError(result.error);
      setNewCriterionName("");
      router.refresh();
    });
  }

  function handleRenameCriterion(id: string, name: string) {
    if (!name.trim()) return;
    startTransition(async () => {
      const result = await updateRubricCriterion({ id, name: name.trim() });
      if ("error" in result) return setError(result.error);
      router.refresh();
    });
  }

  function handleDeleteCriterion(id: string) {
    if (!window.confirm("Remove this criterion and all its descriptors/scores?")) return;
    startTransition(async () => {
      const result = await deleteRubricCriterion(id);
      if ("error" in result) return setError(result.error);
      router.refresh();
    });
  }

  function handleSaveDescriptor(criterionId: string, bandId: string, descriptor: string) {
    if (!descriptor.trim()) return;
    startTransition(async () => {
      const result = await saveRubricLevelDescriptor({ criterion_id: criterionId, band_id: bandId, descriptor });
      if ("error" in result) return setError(result.error);
      router.refresh();
    });
  }

  return (
    <div className="mt-1 rounded-sm border border-dashed border-border p-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[0.625rem] text-muted-foreground underline decoration-dotted hover:text-foreground"
      >
        {open ? "Hide structured rubric" : "Structured rubric"}
        {rubric ? ` (${rubric.criteria.length} criteria)` : " (not set up)"}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {error && <p className="text-[0.625rem] text-danger">{error}</p>}
          {!rubric ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={handleCreateRubric}>
              Set up structured rubric for this sub-strand
            </Button>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] border-collapse text-[0.6875rem]">
                  <thead>
                    <tr>
                      <th className="border border-border bg-muted/40 p-1 text-left">Criterion</th>
                      {bandOptions.map((b) => (
                        <th key={b.id} className="border border-border bg-muted/40 p-1 text-left">
                          {b.label}
                        </th>
                      ))}
                      <th className="border border-border bg-muted/40 p-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {rubric.criteria.map((c) => (
                      <tr key={c.id}>
                        <td className="border border-border p-1 align-top">
                          <Input
                            defaultValue={c.name}
                            className="h-7 text-[0.6875rem]"
                            onBlur={(e) => e.target.value !== c.name && handleRenameCriterion(c.id, e.target.value)}
                          />
                        </td>
                        {bandOptions.map((b) => {
                          const existing = c.descriptors.find((d) => d.band_id === b.id)?.descriptor ?? "";
                          return (
                            <td key={b.id} className="border border-border p-1 align-top">
                              <Textarea
                                defaultValue={existing}
                                rows={2}
                                className="min-w-[10rem] text-[0.6875rem]"
                                onBlur={(e) => e.target.value !== existing && handleSaveDescriptor(c.id, b.id, e.target.value)}
                              />
                            </td>
                          );
                        })}
                        <td className="border border-border p-1 align-top">
                          <button
                            type="button"
                            className="text-danger hover:underline"
                            disabled={pending}
                            onClick={() => handleDeleteCriterion(c.id)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-end gap-2">
                <Input
                  placeholder="New criterion (e.g. Uses evidence to support reasoning)"
                  value={newCriterionName}
                  onChange={(e) => setNewCriterionName(e.target.value)}
                  className="max-w-sm"
                />
                <Button size="sm" variant="ghost" disabled={pending} onClick={handleAddCriterion}>
                  Add criterion
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface CriterionScore {
  criterion_id: string;
  band_id: string;
  feedback: string | null;
}

/**
 * Teacher-facing scoring panel for one saved competency_marks rating --
 * shown next to EvidenceButton, only when the sub-strand has a structured
 * rubric. Scores/feedback are per criterion, saved independently so a
 * teacher can score one criterion at a time without losing others.
 */
export function RubricScoreButton({
  competencyMarkId,
  rubric,
  bandOptions,
  canEnter,
  examStatus,
}: {
  competencyMarkId: string;
  rubric: RubricDetail;
  bandOptions: BandOption[];
  canEnter: boolean;
  examStatus: "open" | "closed";
}) {
  const [open, setOpen] = useState(false);
  const [scores, setScores] = useState<CriterionScore[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { band_id: string; feedback: string }>>({});

  function load() {
    startTransition(async () => {
      const result = await listRubricCriterionScores(competencyMarkId);
      if ("error" in result) return setError(result.error);
      setScores(result.items);
      const next: Record<string, { band_id: string; feedback: string }> = {};
      for (const item of result.items) {
        next[item.criterion_id] = { band_id: item.band_id, feedback: item.feedback ?? "" };
      }
      setDrafts(next);
    });
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && scores === null) load();
  }

  function handleSave(criterionId: string) {
    const draft = drafts[criterionId];
    if (!draft?.band_id) return setError("Pick a performance level first.");
    let edit_reason: string | undefined;
    if (examStatus === "closed" && scores?.some((s) => s.criterion_id === criterionId)) {
      edit_reason = window.prompt("Reason for editing this closed-exam rubric score?") ?? undefined;
      if (!edit_reason) return;
    }
    startTransition(async () => {
      const result = await saveRubricCriterionScore({
        competency_mark_id: competencyMarkId,
        criterion_id: criterionId,
        band_id: draft.band_id,
        feedback: draft.feedback,
        edit_reason,
      });
      if ("error" in result) return setError(result.error);
      load();
    });
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={toggle}
        className="text-[0.625rem] text-muted-foreground underline decoration-dotted hover:text-foreground"
      >
        {open ? "Hide rubric" : "Rubric"}
        {scores && scores.length > 0 ? ` (${scores.length}/${rubric.criteria.length})` : ""}
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-2 rounded-sm border border-border bg-muted/30 p-2">
          {error && <p className="text-[0.625rem] text-danger">{error}</p>}
          {scores === null ? (
            <p className="text-[0.625rem] text-muted-foreground">Loading…</p>
          ) : (
            rubric.criteria.map((c) => {
              const draft = drafts[c.id] ?? { band_id: "", feedback: "" };
              const descriptor = c.descriptors.find((d) => d.band_id === draft.band_id)?.descriptor;
              return (
                <div key={c.id} className="flex flex-col gap-1 border-b border-border/60 pb-2 last:border-0 last:pb-0">
                  <p className="text-[0.6875rem] font-medium">{c.name}</p>
                  <Select
                    value={draft.band_id}
                    onValueChange={(v) => setDrafts((prev) => ({ ...prev, [c.id]: { ...draft, band_id: v } }))}
                    disabled={!canEnter}
                  >
                    <SelectTrigger className="h-7 w-32 text-[0.6875rem]">
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
                  {descriptor && <p className="text-[0.625rem] italic text-muted-foreground">{descriptor}</p>}
                  {canEnter && (
                    <>
                      <Textarea
                        value={draft.feedback}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [c.id]: { ...draft, feedback: e.target.value } }))}
                        rows={2}
                        placeholder="Optional feedback (max 500 chars)"
                        maxLength={500}
                        className="text-[0.6875rem]"
                      />
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => handleSave(c.id)} className="w-fit">
                        Save
                      </Button>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
