"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { submitMarks, editMark } from "@/app/(app)/exams/actions";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { queueMutation } from "@/lib/offline/queue";
import { ExamsOfflineBanner } from "./offline-banner";

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
  const { online, pendingCount, failed, syncing, sync, discard } = useOfflineSync("exams");
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
  // Marks submitted while offline: queued locally, not yet confirmed by the
  // server. Kept separate from `draft` so they render distinctly and can't
  // be edited or re-submitted while a sync is still pending. Mirrors
  // attendance's register-form.tsx.
  const [queued, setQueued] = useState<Record<string, string>>({});
  const [correctTarget, setCorrectTarget] = useState<MarksRosterRow | null>(null);
  const [correctValue, setCorrectValue] = useState("");
  const [correctReason, setCorrectReason] = useState("");

  // Derived, not stored: once a queued student's row shows up as `existing`
  // (confirmed by the server after a refresh), it drops out of view here
  // automatically.
  const visibleQueued = Object.fromEntries(
    Object.entries(queued).filter(([studentId]) => !roster.find((r) => r.student_id === studentId)?.existing),
  );
  const queuedCount = Object.keys(visibleQueued).length;

  // Once this class/subject's queued marks are confirmed by the server, pull
  // the authoritative roster so "queued" rows become real "existing" rows.
  useEffect(() => {
    if (online && queuedCount > 0 && pendingCount === 0 && !syncing && !pending) {
      router.refresh();
    }
  }, [online, queuedCount, pendingCount, syncing, pending, router]);

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
    // bulk save only fills in students without a mark yet and not already
    // queued; use Correct for existing ones.
    const rows = roster
      .filter((r) => !r.existing && !(r.student_id in visibleQueued))
      .map((r) => ({ student_id: r.student_id, value: draft[r.student_id] }))
      .filter((r) => !!r.value);

    if (rows.length === 0) {
      setPending(false);
      return;
    }

    if (!online) {
      try {
        const marks = rows.map((r) =>
          gradingModel === "numeric" ? { student_id: r.student_id, raw_score: Number(r.value) } : { student_id: r.student_id, band_id: r.value },
        );
        await queueMutation("exams", "submitMarks", { exam_id: examId, class_id: classId, subject_id: subjectId, marks });
        setQueued((q) => ({ ...q, ...Object.fromEntries(rows.map((r) => [r.student_id, r.value])) }));
      } catch {
        setError("Couldn't save offline either — try again in a moment.");
      }
      setPending(false);
      return;
    }

    const marks = rows.map((r) =>
      gradingModel === "numeric" ? { student_id: r.student_id, raw_score: Number(r.value) } : { student_id: r.student_id, band_id: r.value },
    );
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

  const unmarkedAll = roster.filter((r) => !r.existing);
  const unmarked = unmarkedAll.filter((r) => !(r.student_id in visibleQueued));
  const marked = roster.filter((r) => r.existing);

  return (
    <div className="flex flex-col gap-4">
      <ExamsOfflineBanner online={online} pendingCount={pendingCount} failed={failed} syncing={syncing} sync={sync} discard={discard} />
      {error && <p className="text-sm text-danger">{error}</p>}

      {unmarkedAll.length > 0 && (
        <div className="panel">
          <header className="border-b border-border px-4 py-2.5">
            <h2 className="text-[0.8125rem] font-semibold">To enter · {unmarkedAll.length} students</h2>
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
              {unmarkedAll.map((r) => {
                const isQueued = r.student_id in visibleQueued;
                return (
                <TableRow key={r.student_id}>
                  <TableCell className="font-medium">{r.full_name}</TableCell>
                  <TableCell>
                    {canEnter && !isQueued ? (
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
                    ) : isQueued ? (
                      gradingModel === "numeric" ? visibleQueued[r.student_id] : (bandOptions.find((b) => b.id === visibleQueued[r.student_id])?.label ?? visibleQueued[r.student_id])
                    ) : (
                      "—"
                    )}
                    {isQueued && (
                      <p className="mt-1 flex items-center gap-1 text-[0.625rem] text-muted-foreground">
                        <WifiOff className="size-3" aria-hidden /> Saved offline — will sync automatically
                      </p>
                    )}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
          {canEnter && examStatus === "open" && unmarked.length > 0 && (
            <div className="flex justify-end border-t border-border px-4 py-2.5">
              <Button onClick={handleSaveAll} disabled={pending}>
                {pending
                  ? online
                    ? "Saving…"
                    : "Saving offline…"
                  : online
                    ? `Save ${unmarked.length} marks`
                    : `Save offline (${unmarked.length})`}
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
