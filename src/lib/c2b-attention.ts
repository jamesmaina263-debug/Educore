// Paybill (C2B) events that need a person: PURE helpers only (no I/O, no imports). This file is imported by
// a client component (the Paybill screen), so it must never import anything that only runs on the server. The alerting
// function lives in c2b-stale-alert.ts for that reason; a test below guards the rule.

/** A parked (`deferred_to_stk`) event older than this has missed its normal 20-35 minute resolution. */
export const STALE_DEFERRED_AFTER_MINUTES = 60;
/** How far back the bursar-facing "failed" count looks. A failed event has no resolved state yet. */
export const FAILED_LOOKBACK_DAYS = 30;
export const MAX_STALE_ROWS = 500;

export interface StaleRow {
  school_id: string;
  created_at: string;
}

export interface StaleSummary {
  count: number;
  capped: boolean;
  schools: number;
  oldestMinutes: number;
}

export function staleCutoffIso(now: Date, afterMinutes = STALE_DEFERRED_AFTER_MINUTES): string {
  return new Date(now.getTime() - afterMinutes * 60_000).toISOString();
}

export function failedSinceIso(now: Date, days = FAILED_LOOKBACK_DAYS): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/** Null when nothing is stale. Rows with an unparseable time are ignored rather than trusted. */
export function summariseStale(rows: StaleRow[], now: Date): StaleSummary | null {
  const usable = rows.filter((r) => !Number.isNaN(Date.parse(r.created_at)));
  if (usable.length === 0) return null;
  const oldest = Math.min(...usable.map((r) => Date.parse(r.created_at)));
  return {
    count: usable.length,
    capped: rows.length >= MAX_STALE_ROWS,
    schools: new Set(usable.map((r) => r.school_id)).size,
    oldestMinutes: Math.max(0, Math.round((now.getTime() - oldest) / 60_000)),
  };
}

/** The 15-minute resolver cron alerts only on its first run of each UTC hour, so a stuck event pages hourly, not every 15 minutes. */
export function isFirstRunOfHour(now: Date): boolean {
  return now.getUTCMinutes() < 15;
}

export interface AttentionInput {
  failedCount: number;
  staleDeferred: number;
}

/** Plain-language lines for the bursar-facing banner. Empty when nothing needs attention. */
export function attentionLines({ failedCount, staleDeferred }: AttentionInput): string[] {
  const lines: string[] = [];
  if (failedCount > 0) {
    lines.push(
      `${failedCount} paybill ${failedCount === 1 ? "payment" : "payments"} could not be processed in the last ${FAILED_LOOKBACK_DAYS} days. The money reached your paybill, but nothing was recorded. Record ${failedCount === 1 ? "it" : "them"} by hand from your M-Pesa statement, then tell EduCore support.`,
    );
  }
  if (staleDeferred > 0) {
    lines.push(
      `${staleDeferred} paybill ${staleDeferred === 1 ? "payment has" : "payments have"} been waiting for confirmation for over an hour. Check your M-Pesa statement and tell EduCore support if ${staleDeferred === 1 ? "it is" : "they are"} still not recorded.`,
    );
  }
  return lines;
}
