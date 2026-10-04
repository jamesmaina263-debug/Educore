// Pure helpers for /api/cron/mpesa-stale-pending (kept separate from the route so the
// selection/dedup rules are unit-testable without a database).

export const MPESA_STALE_PENDING_EVENT = "M-Pesa: STK request(s) still pending -- callback not processed";

// A customer who ignores or cancels a prompt still produces a Daraja callback (result code
// 1032/1037, which marks the row 'failed'), so a *dispatched* row that is still 'pending' this
// long after it was sent means the callback never got processed (rejected, lost, or errored).
export const STALE_AFTER_MINUTES = 10;
// Look back far enough to survive a few missed cron runs, but not so far that long-dead rows
// (e.g. old sandbox tests) keep resurfacing.
export const LOOKBACK_HOURS = 24;

export interface StaleCandidate {
  id: string;
  initiated_at: string;
}

/** Cutoffs (ISO strings) for the "pending for >10 min, but not older than 24h" window. */
export function staleWindow(now: Date): { olderThan: string; notOlderThan: string } {
  return {
    olderThan: new Date(now.getTime() - STALE_AFTER_MINUTES * 60_000).toISOString(),
    notOlderThan: new Date(now.getTime() - LOOKBACK_HOURS * 3_600_000).toISOString(),
  };
}

/** Parses the comma-separated request_ids stored in earlier alerts' detail. */
export function alertedIdsFromDetails(details: Array<Record<string, unknown> | null>): Set<string> {
  const ids = new Set<string>();
  for (const d of details) {
    const raw = d?.request_ids;
    if (typeof raw !== "string") continue;
    for (const id of raw.split(",")) {
      const trimmed = id.trim();
      if (trimmed) ids.add(trimmed);
    }
  }
  return ids;
}

/** Rows not already covered by a previous alert, so each stuck row alerts once, not every run. */
export function newlyStale<T extends StaleCandidate>(rows: T[], alreadyAlerted: Set<string>): T[] {
  return rows.filter((r) => !alreadyAlerted.has(r.id));
}

export function oldestAgeMinutes(rows: StaleCandidate[], now: Date): number {
  if (rows.length === 0) return 0;
  const oldest = Math.min(...rows.map((r) => new Date(r.initiated_at).getTime()));
  return Math.round((now.getTime() - oldest) / 60_000);
}

// How many stuck rows one cron run asks the mpesa-stk-query function about (Daraja spike-arrests
// at burst 3 / 30 per minute, and the function spaces its calls ~2s apart).
export const RECONCILE_BATCH_SIZE = 5;

export interface ReconcileCandidate extends StaleCandidate {
  last_query_at: string | null;
}

/**
 * Picks which stale rows to ask Daraja about this run: never-queried rows first, then the least
 * recently queried, oldest first within a tie. Without this, a few rows Daraja can never answer
 * (e.g. old sandbox requests) would occupy the batch forever and starve newer stuck rows.
 */
export function pickReconcileBatch<T extends ReconcileCandidate>(rows: T[], size = RECONCILE_BATCH_SIZE): T[] {
  const key = (r: T) => (r.last_query_at ? new Date(r.last_query_at).getTime() : -Infinity);
  return [...rows]
    .sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka !== kb) return ka < kb ? -1 : 1;
      return new Date(a.initiated_at).getTime() - new Date(b.initiated_at).getTime();
    })
    .slice(0, size);
}
