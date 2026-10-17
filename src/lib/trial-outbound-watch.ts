// Pure helpers for /api/cron/trial-outbound-watch (kept separate from the route so the
// selection/dedup rules are unit-testable without a database).
//
// A brand-new free-trial school that starts pushing SMS / email / WhatsApp out in its first day is
// either a school genuinely testing the product or an abuser using the trial as a free sender.
// SMS costs real money, so a human should look. This only raises an alert; it never blocks or
// suspends anything.

export const TRIAL_OUTBOUND_EVENT = "Trial school sending messages in its first day";

/** Only schools created this recently count as "new". */
export const NEW_SCHOOL_WINDOW_HOURS = 24;
/** Alert once a trial school has sent at least this many external messages. Tune as needed. */
export const OUTBOUND_THRESHOLD = 3;

/** Cutoff (ISO string) for "created within the last 24h". */
export function newSchoolCutoff(now: Date): string {
  return new Date(now.getTime() - NEW_SCHOOL_WINDOW_HOURS * 3_600_000).toISOString();
}

export interface OutboundMessageRow {
  school_id: string;
}

/** Message counts per school. */
export function countBySchool(rows: OutboundMessageRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.school_id, (counts.get(r.school_id) ?? 0) + 1);
  return counts;
}

/** Parses the comma-separated school_ids stored in earlier alerts' detail. */
export function alertedSchoolIdsFromDetails(details: Array<Record<string, unknown> | null>): Set<string> {
  const ids = new Set<string>();
  for (const d of details) {
    const raw = d?.school_ids;
    if (typeof raw !== "string") continue;
    for (const id of raw.split(",")) {
      const trimmed = id.trim();
      if (trimmed) ids.add(trimmed);
    }
  }
  return ids;
}

export interface SchoolOutbound {
  schoolId: string;
  count: number;
}

/**
 * Schools over the threshold that have not been alerted about before, highest volume first.
 * Each school alerts once, not on every run.
 */
export function schoolsToAlert(
  counts: Map<string, number>,
  alreadyAlerted: Set<string>,
  threshold: number = OUTBOUND_THRESHOLD,
): SchoolOutbound[] {
  return [...counts.entries()]
    .filter(([schoolId, count]) => count >= threshold && !alreadyAlerted.has(schoolId))
    .map(([schoolId, count]) => ({ schoolId, count }))
    .sort((a, b) => b.count - a.count);
}
