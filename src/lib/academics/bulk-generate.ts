import type { ClassOverviewRow } from "@/lib/academics/load-class-overview";

// "Generate all classes" for one exam. It adds NO new storage and NO new generation logic: it calls the
// existing per-class generateReportCards action once per class from the browser, a few classes at a
// time, so no request is long and each class succeeds or fails on its own.
//
// Safety comes from generate_report_cards itself, not from this file: it inserts with
// ON CONFLICT (exam_id, student_id) DO NOTHING, so running a class twice, or two admins running at once,
// can never duplicate a card, and an existing card (approved or not) is never touched. The run's
// progress is not stored anywhere: the overview counts ARE the state, so closing the tab only stops the
// classes not yet started, and running it again picks up exactly what is still missing.

export interface GenerateTarget {
  classId: string;
  className: string;
  /** Active students currently without a card in this class (0 when unknown because the counts failed to load). */
  pending: number;
}

export type ClassRunStatus = "queued" | "running" | "done" | "failed";

export interface ClassRun {
  classId: string;
  className: string;
  status: ClassRunStatus;
  /** Report cards newly created for this class (0 = it was already up to date). */
  created: number | null;
  error: string | null;
}

export type GenerateStopReason = "cancelled" | "unavailable" | null;

export interface GenerateAllState {
  runs: ClassRun[];
  stopReason: GenerateStopReason;
}

type GenerateResult = { error: string } | { success: true; created?: number };

/** Which classes a "generate all" would actually touch, and how many are already complete. */
export function planGenerateAll(rows: ClassOverviewRow[]): { targets: GenerateTarget[]; upToDate: number; empty: number; pendingStudents: number } {
  const targets: GenerateTarget[] = [];
  let upToDate = 0;
  let empty = 0;
  let pendingStudents = 0;
  for (const r of rows) {
    if (r.loadFailed) {
      // Counts unavailable: include it, generation is idempotent so an unnecessary run is harmless.
      targets.push({ classId: r.classId, className: r.className, pending: 0 });
    } else if (r.summary.total === 0) {
      empty += 1;
    } else if (r.summary.pending > 0) {
      targets.push({ classId: r.classId, className: r.className, pending: r.summary.pending });
      pendingStudents += r.summary.pending;
    } else {
      upToDate += 1;
    }
  }
  return { targets, upToDate, empty, pendingStudents };
}

/** Errors that mean every other class will fail the same way (no permission, exam not closed, signed out). */
export function isSystemicGenerateError(message: string): boolean {
  return /not authorized to generate|can only be generated from a closed exam|exam not found|session|not signed in|must be signed in/i.test(message);
}

export async function runGenerateAll(
  targets: GenerateTarget[],
  generate: (target: GenerateTarget) => Promise<GenerateResult>,
  opts: { concurrency?: number; isCancelled?: () => boolean; onUpdate?: (state: GenerateAllState) => void; previous?: ClassRun[] } = {},
): Promise<GenerateAllState> {
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  // A retry keeps the earlier results for classes that are not being re-run.
  const byId = new Map<string, ClassRun>((opts.previous ?? []).map((r) => [r.classId, r]));
  for (const t of targets) byId.set(t.classId, { classId: t.classId, className: t.className, status: "queued", created: null, error: null });
  const order = [...new Set([...(opts.previous ?? []).map((r) => r.classId), ...targets.map((t) => t.classId)])];
  const state: GenerateAllState = { runs: [], stopReason: null };
  const snapshot = () => {
    state.runs = order.map((id) => ({ ...(byId.get(id) as ClassRun) }));
    opts.onUpdate?.({ runs: state.runs, stopReason: state.stopReason });
  };
  snapshot();

  let next = 0;
  const worker = async () => {
    while (state.stopReason === null) {
      if (opts.isCancelled?.()) {
        state.stopReason = "cancelled";
        return;
      }
      const index = next++;
      if (index >= targets.length) return;
      const target = targets[index];
      byId.set(target.classId, { ...(byId.get(target.classId) as ClassRun), status: "running" });
      snapshot();
      let result: GenerateResult;
      try {
        result = await generate(target);
      } catch {
        result = { error: "Couldn't reach the server. Please try again." };
      }
      if ("error" in result) {
        byId.set(target.classId, { classId: target.classId, className: target.className, status: "failed", created: null, error: result.error });
        if (isSystemicGenerateError(result.error) && state.stopReason === null) state.stopReason = "unavailable";
      } else {
        byId.set(target.classId, { classId: target.classId, className: target.className, status: "done", created: result.created ?? 0, error: null });
      }
      snapshot();
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(targets.length, 1)) }, worker));
  snapshot();
  return { runs: state.runs, stopReason: state.stopReason };
}

export function summariseRuns(runs: ClassRun[]): { total: number; done: number; failed: number; running: number; queued: number; created: number } {
  let done = 0;
  let failed = 0;
  let running = 0;
  let queued = 0;
  let created = 0;
  for (const r of runs) {
    if (r.status === "done") {
      done += 1;
      created += r.created ?? 0;
    } else if (r.status === "failed") failed += 1;
    else if (r.status === "running") running += 1;
    else queued += 1;
  }
  return { total: runs.length, done, failed, running, queued, created };
}
