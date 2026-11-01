"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { generateReportCards } from "@/app/(app)/exams/report-cards/actions";
import {
  planGenerateAll,
  runGenerateAll,
  summariseRuns,
  type ClassRun,
  type GenerateAllState,
  type GenerateTarget,
} from "@/lib/academics/bulk-generate";
import type { ClassOverviewRow } from "@/lib/academics/load-class-overview";

const RUN_BADGE: Record<ClassRun["status"], { tone: "neutral" | "info" | "success" | "danger"; label: string }> = {
  queued: { tone: "neutral", label: "Waiting" },
  running: { tone: "info", label: "Generating…" },
  done: { tone: "success", label: "Done" },
  failed: { tone: "danger", label: "Failed" },
};

// "Generate all classes" on the Report Cards overview. It runs the existing per-class generation once
// per class, a few at a time, with a status line per class; a class that fails can be retried on its
// own. Nothing is stored for the run: the overview counts are the state, so it is safe to close the
// window (classes not yet started simply stay pending) and run it again later.
export function GenerateAllClasses({ examId, rows, canGenerate }: { examId: string; rows: ClassOverviewRow[]; canGenerate: boolean }) {
  const router = useRouter();
  const plan = useMemo(() => planGenerateAll(rows), [rows]);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [state, setState] = useState<GenerateAllState | null>(null);
  const cancelled = useRef(false);
  const startedRef = useRef(false); // guards against a double click starting two runs

  const summary = state ? summariseRuns(state.runs) : null;
  const finished = state !== null && !running;
  const failedRuns = state?.runs.filter((r) => r.status === "failed") ?? [];

  async function start(targets: GenerateTarget[], previous?: ClassRun[]) {
    if (startedRef.current) return;
    startedRef.current = true;
    cancelled.current = false;
    setRunning(true);
    const result = await runGenerateAll(
      targets,
      (t) => generateReportCards(examId, t.classId, { skipRevalidate: true }),
      { concurrency: 3, isCancelled: () => cancelled.current, onUpdate: setState, previous },
    );
    setState(result);
    setRunning(false);
    startedRef.current = false;
    router.refresh();
  }

  function retryFailed() {
    if (!state) return;
    const targets: GenerateTarget[] = failedRuns.map((r) => ({ classId: r.classId, className: r.className, pending: 0 }));
    void start(targets, state.runs);
  }

  function close() {
    if (running) return;
    setOpen(false);
    setState(null);
  }

  // The panel hides once nothing is left to generate, but the dialog below stays mounted: when the last
  // class finishes the page refreshes, the count drops to zero, and the results must not vanish with it.
  return (
    <>
      {plan.targets.length === 0 ? (
        !state && (
          <div className="panel flex flex-wrap items-center gap-2 p-3 text-sm text-muted-foreground">
            {rows.length > 0 ? "Report cards are generated for every class with students." : "This exam has no classes."}
          </div>
        )
      ) : (
        <div className="panel flex flex-wrap items-center gap-x-4 gap-y-2 p-3 text-sm">
          <span>
            <strong className="tabular-nums">{plan.targets.length}</strong> {plan.targets.length === 1 ? "class needs" : "classes need"} report cards
            {plan.pendingStudents > 0 && (
              <>
                {" "}
                (<strong className="tabular-nums">{plan.pendingStudents}</strong> {plan.pendingStudents === 1 ? "student" : "students"} without one)
              </>
            )}
          </span>
          {canGenerate ? (
            <Button size="sm" className="ml-auto" onClick={() => setOpen(true)}>
              Generate all classes ({plan.targets.length})
            </Button>
          ) : (
            <span className="ml-auto text-xs text-muted-foreground">Generating report cards needs exam-write access.</span>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={(next) => !next && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{state ? "Generating report cards" : `Generate report cards for ${plan.targets.length} ${plan.targets.length === 1 ? "class" : "classes"}?`}</DialogTitle>
            <DialogDescription>
              {state === null
                ? "This creates a report card for every active student who doesn't have one yet. Cards that already exist, including approved ones, are never changed, and nothing is released to parents until comments are approved. Classes are generated a few at a time and any that fail can be retried."
                : running
                  ? "Keep this window open while it runs."
                  : state.stopReason === "unavailable"
                    ? "Stopped: this can't be done right now. See the message below."
                    : state.stopReason === "cancelled"
                      ? "Stopped. Classes not started are still pending; run Generate all again to continue."
                      : failedRuns.length > 0
                        ? "Finished with some failures."
                        : "Finished."}
            </DialogDescription>
          </DialogHeader>

          {state && summary && (
            <div className="flex flex-col gap-2 text-sm" aria-live="polite">
              <p>
                {summary.done} of {summary.total} classes done
                {summary.failed > 0 && ` · ${summary.failed} failed`} · {summary.created} new report {summary.created === 1 ? "card" : "cards"}
              </p>
              <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {state.runs.map((r) => {
                  const badge = RUN_BADGE[r.status];
                  return (
                    <li key={r.classId} className="flex items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{r.className}</span>
                        {r.status === "done" && <span className="block text-xs text-muted-foreground">{r.created ? `${r.created} created` : "Already up to date"}</span>}
                        {r.status === "failed" && <span className="block text-xs text-danger">{r.error}</span>}
                      </span>
                      <StatusBadge tone={badge.tone} label={badge.label} />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <DialogFooter>
            {state === null && (
              <>
                <Button variant="ghost" onClick={close}>
                  Cancel
                </Button>
                <Button onClick={() => start(plan.targets)}>Generate {plan.targets.length} {plan.targets.length === 1 ? "class" : "classes"}</Button>
              </>
            )}
            {running && (
              <Button variant="outline" onClick={() => (cancelled.current = true)}>
                Stop
              </Button>
            )}
            {finished && failedRuns.length > 0 && state?.stopReason !== "unavailable" && (
              <Button variant="outline" onClick={retryFailed}>
                Retry {failedRuns.length} failed
              </Button>
            )}
            {finished && <Button onClick={close}>Done</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
