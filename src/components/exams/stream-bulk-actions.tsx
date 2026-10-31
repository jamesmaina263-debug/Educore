"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { draftCommentWithAI } from "@/app/(app)/exams/report-cards/actions";
import { approveStreamComments } from "@/app/(app)/exams/report-cards/bulk-actions";
import { runBulkDraft, type DraftProgress } from "@/lib/academics/bulk-draft";
import type { StreamGroup } from "@/lib/academics/report-card-status";

// "Draft AI comments" and "Approve" for one stream. Only rendered for streams the user may approve.
//  - Drafting runs from here, one existing per-student draft call at a time (3 in flight), so it keeps
//    that action's permission check and its 60-per-hour limit, and it stops cleanly if the limit is hit.
//    Drafts are NOT released: each still needs approval.
//  - Approving releases cards to parents and queues the one-time guardian SMS, so it asks first and
//    says so. The server picks the cards from current data; nothing here decides who gets approved.
export function StreamBulkActions({
  examId,
  classId,
  stream,
  draftable,
  approvable,
  onChanged,
}: {
  examId: string;
  classId: string;
  stream: StreamGroup;
  draftable: number;
  approvable: number;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"draft" | "approve" | null>(null);

  // drafting
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<DraftProgress | null>(null);
  const cancelled = useRef(false);

  // approving
  const [approving, setApproving] = useState(false);
  const [approveResult, setApproveResult] = useState<{ approved: number; skipped: number } | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);

  const draftItems = stream.students.filter((s) => s.status === "needs_comment").map((s) => ({ id: s.student_id, name: s.full_name }));

  function close() {
    if (running || approving) return;
    const changed = (progress && progress.succeeded > 0) || approveResult !== null;
    setMode(null);
    setProgress(null);
    setApproveResult(null);
    setApproveError(null);
    if (changed) onChanged();
  }

  async function startDraft() {
    cancelled.current = false;
    setRunning(true);
    setProgress({ total: draftItems.length, attempted: 0, succeeded: 0, failed: [], stopReason: null });
    const result = await runBulkDraft(
      draftItems,
      (item) => draftCommentWithAI({ exam_id: examId, student_id: item.id, student_name: item.name, skip_revalidate: true }),
      { concurrency: 3, isCancelled: () => cancelled.current, onProgress: setProgress },
    );
    setProgress(result);
    setRunning(false);
    router.refresh();
  }

  async function startApprove() {
    setApproving(true);
    setApproveError(null);
    const result = await approveStreamComments({ exam_id: examId, class_id: classId, stream_id: stream.id });
    setApproving(false);
    if ("error" in result) {
      setApproveError(result.error);
      router.refresh();
      return;
    }
    setApproveResult(result);
    router.refresh();
  }

  const draftFinished = progress !== null && !running;
  const remaining = progress ? progress.total - progress.succeeded - progress.failed.length : 0;

  return (
    <>
      {/* The bar hides when there is nothing to do, but the dialogs below stay mounted: right after a
          bulk approve the counts drop to zero, and the result dialog must not vanish with them. */}
      {(draftable > 0 || approvable > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/30 px-4 py-2">
          <span className="text-xs text-muted-foreground">Whole stream:</span>
          {draftable > 0 && (
            <Button size="sm" variant="outline" onClick={() => setMode("draft")}>
              Draft AI comments ({draftable})
            </Button>
          )}
          {approvable > 0 && (
            <Button size="sm" onClick={() => setMode("approve")}>
              Approve {approvable} {approvable === 1 ? "comment" : "comments"}
            </Button>
          )}
        </div>
      )}

      <Dialog open={mode === "draft"} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Draft AI comments for {stream.name}</DialogTitle>
            <DialogDescription>
              {progress === null
                ? `AI will write a first-draft comment for ${draftItems.length} ${draftItems.length === 1 ? "student" : "students"} who have none. Drafts are not released to parents: each one still needs a teacher to approve it. AI drafting is limited to 60 requests per hour per person, so a large stream may need finishing later.`
                : running
                  ? "Drafting… keep this window open."
                  : "Finished."}
            </DialogDescription>
          </DialogHeader>

          {progress && (
            <div className="flex flex-col gap-2 text-sm" aria-live="polite">
              <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.attempted}>
                <div className="h-full bg-primary transition-all" style={{ width: `${progress.total ? (progress.attempted / progress.total) * 100 : 0}%` }} />
              </div>
              <p>
                {progress.succeeded} drafted
                {progress.failed.length > 0 && ` · ${progress.failed.length} failed`} · {progress.attempted} of {progress.total} tried
              </p>
              {draftFinished && progress.stopReason === "rate_limit" && (
                <p className="text-warning">
                  The hourly AI limit was reached. {remaining} {remaining === 1 ? "student was" : "students were"} not drafted; run this again in about an hour to finish.
                </p>
              )}
              {draftFinished && progress.stopReason === "unavailable" && (
                <p className="text-danger">AI drafting isn&apos;t available right now ({progress.failed[progress.failed.length - 1]?.error}).</p>
              )}
              {draftFinished && progress.stopReason === "cancelled" && <p className="text-muted-foreground">Stopped. {remaining} not drafted.</p>}
              {draftFinished && progress.failed.length > 0 && progress.stopReason === null && (
                <p className="text-warning">{progress.failed.map((f) => f.name).join(", ")} could not be drafted. You can write those comments by hand or run this again.</p>
              )}
            </div>
          )}

          <DialogFooter>
            {progress === null && (
              <>
                <Button variant="ghost" onClick={close}>
                  Cancel
                </Button>
                <Button onClick={startDraft} disabled={draftItems.length === 0}>
                  Draft {draftItems.length} {draftItems.length === 1 ? "comment" : "comments"}
                </Button>
              </>
            )}
            {running && (
              <Button variant="outline" onClick={() => (cancelled.current = true)}>
                Stop
              </Button>
            )}
            {draftFinished && <Button onClick={close}>Done</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mode === "approve"} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {approveResult ? "Comments approved" : `Approve ${approvable} ${approvable === 1 ? "comment" : "comments"} in ${stream.name}?`}
            </DialogTitle>
            <DialogDescription>
              {approveResult
                ? `${approveResult.approved} approved${approveResult.skipped > 0 ? `, ${approveResult.skipped} skipped (changed in the meantime, or not yours to approve)` : ""}.`
                : "This releases these report cards to parents. They become visible in the parent portal, and each guardian is sent one SMS the first time a card is released (it names the school, the child's first name and the exam, never marks or comment text). By approving you confirm you have read these comments. Cards with no comment text are never approved here."}
            </DialogDescription>
          </DialogHeader>
          {approveError && <p className="text-sm text-danger">{approveError}</p>}
          <DialogFooter>
            {approveResult ? (
              <Button onClick={close}>Done</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={close} disabled={approving}>
                  Cancel
                </Button>
                <Button onClick={startApprove} disabled={approving || approvable === 0}>
                  {approving ? "Approving…" : `Approve ${approvable}`}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
