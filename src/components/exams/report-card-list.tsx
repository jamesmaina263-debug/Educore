"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { generateReportCards, approveComment, writeComment, draftCommentWithAI } from "@/app/exams/report-cards/actions";

export interface StudentMarkLine {
  subject_name: string;
  raw_score: number | null;
  band_label: string | null;
}

export interface ReportCardRow {
  student_id: string;
  full_name: string;
  marks: StudentMarkLine[];
  rank_in_stream: number | null;
  average_score: number | null;
  report_card: {
    comment: string | null;
    comment_source: "none" | "ai" | "teacher_approved" | "teacher_written";
  } | null;
}

export function ReportCardList({
  examId,
  classId,
  rows,
  canGenerate,
  canApprove,
}: {
  examId: string;
  classId: string;
  rows: ReportCardRow[];
  canGenerate: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  async function handleGenerate() {
    setPending(true);
    setError(null);
    const result = await generateReportCards(examId, classId);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function handleApprove(studentId: string) {
    setPending(true);
    const result = await approveComment({ exam_id: examId, student_id: studentId });
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function handleWrite(studentId: string) {
    const comment = drafts[studentId];
    if (!comment?.trim()) return;
    setPending(true);
    const result = await writeComment({ exam_id: examId, student_id: studentId, comment });
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function handleDraftAI(studentId: string, studentName: string) {
    setPending(true);
    setError(null);
    const result = await draftCommentWithAI({ exam_id: examId, student_id: studentId, student_name: studentName });
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  const noneGenerated = rows.every((r) => !r.report_card);

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      {noneGenerated ? (
        canGenerate ? (
          <div className="panel border-dashed p-6 text-center">
            <p className="mb-3 text-sm text-muted-foreground">No report cards generated yet for this class.</p>
            <Button onClick={handleGenerate} disabled={pending}>
              {pending ? "Generating…" : "Generate for whole class"}
            </Button>
          </div>
        ) : (
          <div className="panel border-dashed p-6 text-center text-sm text-muted-foreground">
            No report cards generated yet.
          </div>
        )
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((r) => (
            <div key={r.student_id} className="panel p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-medium">{r.full_name}</p>
                {r.average_score !== null && (
                  <p className="text-sm text-muted-foreground">
                    Average {r.average_score} {r.rank_in_stream ? `— Rank ${r.rank_in_stream} in stream` : ""}
                  </p>
                )}
              </div>

              <div className="overflow-x-auto rounded-md border border-border">
                <Table className="table-dense">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subject</TableHead>
                      <TableHead>Mark</TableHead>
                      <TableHead>Grade</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.marks.map((m) => (
                      <TableRow key={m.subject_name}>
                        <TableCell>{m.subject_name}</TableCell>
                        <TableCell>{m.raw_score ?? "—"}</TableCell>
                        <TableCell>{m.band_label ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {r.report_card && (
                <div className="mt-3">
                  {r.report_card.comment_source === "ai" ? (
                    <div className="rounded-md border border-info/30 bg-info/10 p-3">
                      <div className="mb-1 flex items-center gap-2">
                        <StatusBadge tone="info" label="AI-drafted comment — needs approval" />
                      </div>
                      <p className="text-sm">{r.report_card.comment}</p>
                      {canApprove && (
                        <Button size="sm" className="mt-2" disabled={pending} onClick={() => handleApprove(r.student_id)}>
                          Approve
                        </Button>
                      )}
                    </div>
                  ) : r.report_card.comment_source === "teacher_approved" || r.report_card.comment_source === "teacher_written" ? (
                    <div className="rounded-md border border-success/30 bg-success/10 p-3">
                      <StatusBadge
                        tone="success"
                        label={r.report_card.comment_source === "teacher_approved" ? "Approved" : "Teacher comment"}
                      />
                      <p className="mt-1 text-sm">{r.report_card.comment}</p>
                    </div>
                  ) : canApprove ? (
                    <div className="flex flex-col gap-2">
                      <Textarea
                        placeholder="Write a comment for this student's report card…"
                        rows={2}
                        value={drafts[r.student_id] ?? ""}
                        onChange={(e) => setDrafts((p) => ({ ...p, [r.student_id]: e.target.value }))}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending || !drafts[r.student_id]?.trim()}
                          onClick={() => handleWrite(r.student_id)}
                        >
                          Save comment
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => handleDraftAI(r.student_id, r.full_name)}
                        >
                          {pending ? "Drafting…" : "Draft with AI"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No comment yet.</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
