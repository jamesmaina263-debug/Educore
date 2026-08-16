"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { submitMarks, editMark } from "@/app/(app)/exams/actions";

export interface MarksRosterRow {
  student_id: string;
  full_name: string;
  existing: { raw_score: number | null; band_id: string | null } | null;
}

export interface BandOption {
  id: string;
  label: string;
}

export function MarksEntryForm({
  examId,
  classId,
  subjectId,
  gradingModel,
  bandOptions,
  maxScore,
  roster,
  examStatus,
  canEnter,
}: {
  examId: string;
  classId: string;
  subjectId: string;
  gradingModel: "numeric" | "cbc";
  bandOptions: BandOption[];
  maxScore: number;
  roster: MarksRosterRow[];
  examStatus: "open" | "closed";
  canEnter: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(
    Object.fromEntries(
      roster.map((r) => [
        r.student_id,
        gradingModel === "numeric" ? String(r.existing?.raw_score ?? "") : r.existing?.band_id ?? "",
      ]),
    ),
  );
  const [correctTarget, setCorrectTarget] = useState<MarksRosterRow | null>(null);
  const [correctValue, setCorrectValue] = useState("");
  const [correctReason, setCorrectReason] = useState("");

  if (roster.length === 0) {
    return (
      <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
        No active students in this class.
      </div>
    );
  }

  async function handleSaveAll() {
    setPending(true);
    setError(null);
    const marks = roster
      .filter((r) => !r.existing) // bulk save only fills in students without a mark yet; use Correct for existing ones
      .map((r) => {
        const v = draft[r.student_id];
        if (!v) return null;
        return gradingModel === "numeric" ? { student_id: r.student_id, raw_score: Number(v) } : { student_id: r.student_id, band_id: v };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    const result = await submitMarks({ exam_id: examId, class_id: classId, subject_id: subjectId, marks });
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function handleCorrectSave() {
    if (!correctTarget) return;
    setPending(true);
    setError(null);
    const result = await editMark({
      exam_id: examId,
      student_id: correctTarget.student_id,
      subject_id: subjectId,
      edit_reason: correctReason,
      ...(gradingModel === "numeric" ? { raw_score: Number(correctValue) } : { band_id: correctValue }),
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setCorrectTarget(null);
    setCorrectReason("");
    router.refresh();
  }

  const unmarked = roster.filter((r) => !r.existing);
  const marked = roster.filter((r) => r.existing);

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      {unmarked.length > 0 && (
        <div className="panel">
          <header className="border-b border-border px-4 py-2.5">
            <h2 className="text-[0.8125rem] font-semibold">To enter · {unmarked.length} students</h2>
          </header>
          <div className="overflow-x-auto">
            <Table className="table-dense">
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>{gradingModel === "numeric" ? `Score (out of ${maxScore})` : "Competency level"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unmarked.map((r) => (
                <TableRow key={r.student_id}>
                  <TableCell className="font-medium">{r.full_name}</TableCell>
                  <TableCell>
                    {canEnter ? (
                      gradingModel === "numeric" ? (
                        <Input
                          type="number"
                          className="w-24"
                          max={maxScore}
                          value={draft[r.student_id] ?? ""}
                          onChange={(e) => setDraft((p) => ({ ...p, [r.student_id]: e.target.value }))}
                        />
                      ) : (
                        <Select
                          value={draft[r.student_id] ?? ""}
                          onValueChange={(v) => setDraft((p) => ({ ...p, [r.student_id]: v }))}
                        >
                          <SelectTrigger className="w-56">
                            <SelectValue placeholder="Select level" />
                          </SelectTrigger>
                          <SelectContent>
                            {bandOptions.map((b) => (
                              <SelectItem key={b.id} value={b.id}>
                                {b.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          {canEnter && examStatus === "open" && (
            <div className="flex justify-end border-t border-border px-4 py-2.5">
              <Button onClick={handleSaveAll} disabled={pending}>
                {pending ? "Saving…" : `Save ${unmarked.length} marks`}
              </Button>
            </div>
          )}
        </div>
      )}

      {marked.length > 0 && (
        <div className="panel">
          <header className="border-b border-border px-4 py-2.5">
            <h2 className="text-[0.8125rem] font-semibold">Already entered · {marked.length} students</h2>
          </header>
          <div className="overflow-x-auto">
            <Table className="table-dense">
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Result</TableHead>
                {canEnter && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {marked.map((r) => (
                <TableRow key={r.student_id}>
                  <TableCell className="font-medium">{r.full_name}</TableCell>
                  <TableCell>
                    {gradingModel === "numeric"
                      ? r.existing?.raw_score
                      : bandOptions.find((b) => b.id === r.existing?.band_id)?.label}
                  </TableCell>
                  {canEnter && (
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setCorrectTarget(r);
                          setCorrectValue(
                            gradingModel === "numeric" ? String(r.existing?.raw_score ?? "") : r.existing?.band_id ?? "",
                          );
                        }}
                      >
                        Correct
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </div>
      )}

      <Dialog open={!!correctTarget} onOpenChange={(o) => !o && setCorrectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Correct mark — {correctTarget?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{gradingModel === "numeric" ? `New score (out of ${maxScore})` : "New competency level"}</Label>
              {gradingModel === "numeric" ? (
                <Input type="number" max={maxScore} value={correctValue} onChange={(e) => setCorrectValue(e.target.value)} />
              ) : (
                <Select value={correctValue} onValueChange={setCorrectValue}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select level" />
                  </SelectTrigger>
                  <SelectContent>
                    {bandOptions.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Reason for correction {examStatus === "closed" && "(required — this exam is closed)"}</Label>
              <Textarea value={correctReason} onChange={(e) => setCorrectReason(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleCorrectSave} disabled={pending || !correctValue || (examStatus === "closed" && !correctReason.trim())}>
              {pending ? "Saving…" : "Save correction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
