"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { approveComment, writeComment, draftCommentWithAI } from "@/app/(app)/exams/report-cards/actions";
import { getReportCardDetail } from "@/app/(app)/exams/report-cards/detail-actions";
import { ReportCardInsightsPanel } from "@/components/exams/report-card-insights-panel";
import { RemarkBankPicker } from "@/components/exams/remark-bank-picker";
import { HeadTeacherCommentEditor } from "@/components/exams/head-teacher-comment-editor";
import type { ReportCardDetail } from "@/lib/academics/load-report-card-detail";

// The full review panel for ONE student: marks, insights, CBC competency ratings, comment editing /
// approval and the head teacher's comment. It is mounted only while the row is expanded and fetches
// its own data then, so a class of hundreds costs one small request per row actually opened. The
// comment, approval and head-comment controls are the same ones the always-open list used.
export function StudentReportCardDetail({
  examId,
  classId,
  studentId,
  studentName,
  canApprove,
  headCommentEnabled,
  canCommentHead,
}: {
  examId: string;
  classId: string;
  studentId: string;
  studentName: string;
  canApprove: boolean;
  headCommentEnabled: boolean;
  canCommentHead: boolean;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<ReportCardDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getReportCardDetail(examId, classId, studentId)
      .then((res) => {
        if (cancelled) return;
        if ("error" in res) {
          setLoadError(res.error);
        } else {
          setLoadError(null);
          setDetail(res.detail);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError("Couldn't load this report card. Please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [examId, classId, studentId, reloadKey]);

  // After any change: refresh this panel's data and the page's summary rows / class counts.
  const refreshAll = useCallback(() => {
    setReloadKey((k) => k + 1);
    router.refresh();
  }, [router]);

  async function handleApprove() {
    setPending(true);
    setActionError(null);
    const result = await approveComment({ exam_id: examId, student_id: studentId });
    setPending(false);
    if ("error" in result) return setActionError(result.error);
    refreshAll();
  }

  async function handleWrite() {
    if (!draft.trim()) return;
    setPending(true);
    setActionError(null);
    const result = await writeComment({ exam_id: examId, student_id: studentId, comment: draft });
    setPending(false);
    if ("error" in result) return setActionError(result.error);
    setDraft("");
    refreshAll();
  }

  async function handleDraftAI() {
    setPending(true);
    setActionError(null);
    const result = await draftCommentWithAI({ exam_id: examId, student_id: studentId, student_name: studentName });
    setPending(false);
    if ("error" in result) return setActionError(result.error);
    refreshAll();
  }

  if (loadError && !detail) {
    return (
      <div className="flex items-center gap-3 p-4 text-sm">
        <p className="text-danger">{loadError}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setLoadError(null);
            setReloadKey((k) => k + 1);
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex flex-col gap-2 p-4" aria-busy="true" aria-label={`Loading report card for ${studentName}`}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const { marks, competency, insights, report_card: card } = detail;

  return (
    <div className="p-4">
      {actionError && <p className="mb-2 text-sm text-danger">{actionError}</p>}

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
            {marks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  No marks recorded for this exam.
                </TableCell>
              </TableRow>
            ) : (
              marks.map((m) => (
                <TableRow key={m.subject_name}>
                  <TableCell>{m.subject_name}</TableCell>
                  <TableCell>{m.raw_score ?? "—"}</TableCell>
                  <TableCell>{m.band_label ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-3">
        <ReportCardInsightsPanel insights={insights} />
      </div>

      {competency.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">CBC competency ratings (by sub-strand)</p>
          <div className="overflow-x-auto rounded-md border border-border">
            <Table className="table-dense">
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Strand</TableHead>
                  <TableHead>Sub-strand</TableHead>
                  <TableHead>Level</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {competency.map((c, i) => (
                  <TableRow key={`${c.sub_strand_name}-${i}`}>
                    <TableCell>{c.subject_name}</TableCell>
                    <TableCell>{c.strand_name}</TableCell>
                    <TableCell>{c.sub_strand_name}</TableCell>
                    <TableCell>{c.band_label}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {card && (
        <div className="mt-3">
          {card.comment_source === "ai" ? (
            <div className="rounded-md border border-info/30 bg-info/10 p-3">
              <div className="mb-1 flex items-center gap-2">
                <StatusBadge tone="info" label="AI-drafted comment — needs approval" />
              </div>
              <p className="text-sm">{card.comment}</p>
              {canApprove && (
                <Button size="sm" className="mt-2" disabled={pending} onClick={handleApprove}>
                  Approve
                </Button>
              )}
            </div>
          ) : card.comment_source === "teacher_approved" || card.comment_source === "teacher_written" ? (
            <div className="rounded-md border border-success/30 bg-success/10 p-3">
              <StatusBadge tone="success" label={card.comment_source === "teacher_approved" ? "Approved" : "Teacher comment"} />
              <p className="mt-1 text-sm">{card.comment}</p>
            </div>
          ) : canApprove ? (
            <div className="flex flex-col gap-2">
              <Textarea
                placeholder="Write a comment for this student's report card…"
                rows={2}
                aria-label={`Comment for ${studentName}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <RemarkBankPicker currentText={draft} onInsert={(text) => setDraft((prev) => (prev ? `${prev} ${text}` : text))} />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={pending || !draft.trim()} onClick={handleWrite}>
                  Save comment
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={handleDraftAI}>
                  {pending ? "Drafting…" : "Draft with AI"}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No comment yet.</p>
          )}
        </div>
      )}

      {!card && <p className="mt-3 text-sm text-muted-foreground">A report card hasn&apos;t been generated for this student yet.</p>}

      {card?.id && headCommentEnabled && (
        <HeadTeacherCommentEditor
          reportCardId={card.id}
          initial={card.head_comment ?? ""}
          canEdit={canCommentHead}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
