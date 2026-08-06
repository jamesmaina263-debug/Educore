"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  createCurriculumStrand,
  createCurriculumSubStrand,
  submitCompetencyMarks,
  editCompetencyMark,
} from "@/app/exams/actions";

export interface StrandOption {
  id: string;
  name: string;
  sub_strands: { id: string; name: string }[];
}

export interface CompetencyRatingRow {
  student_id: string;
  sub_strand_id: string;
  band_id: string;
}

export interface CompetencyRosterRow {
  student_id: string;
  full_name: string;
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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Map<string, string>>(
    new Map(existingRatings.map((r) => [`${r.student_id}:${r.sub_strand_id}`, r.band_id])),
  );
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
      const [student_id, sub_strand_id] = key.split(":");
      if (examStatus === "closed" && existingKeys.has(key)) {
        toEdit.push({ student_id, sub_strand_id, band_id });
      } else {
        toSubmit.push({ student_id, sub_strand_id, band_id });
      }
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
          overall subject-level competency above.
        </p>
      </div>
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
            <div key={s.id} className="flex items-end gap-2 pl-4">
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
          ))}
        </div>
      )}

      {subStrandList.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No strands/sub-strands defined for this subject yet.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
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
                      return (
                        <TableCell key={ss.id}>
                          <Select
                            value={ratings.get(key) ?? ""}
                            onValueChange={(v) => setRating(r.student_id, ss.id, v)}
                            disabled={!canEnter}
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
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {canEnter && (
            <Button disabled={pending} onClick={handleSave} className="w-fit">
              {pending ? "Saving…" : "Save competency marks"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
