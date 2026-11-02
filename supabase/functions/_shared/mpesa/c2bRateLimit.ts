// Pure helpers for rate limiting the public C2B confirmation endpoint (no Deno imports, so vitest can
// test them from src/lib). The limiter itself is the existing database primitive
// increment_and_check_rate_limit(bucket, max, window_seconds); this file only decides bucket names and
// how to read its answer.
//
// Design rule: this endpoint always answers HTTP 200 and Safaricom does not resend after a 200, so a
// request carrying a valid school token must NEVER be dropped by a limiter -- that could lose a real
// payment. Limiting therefore applies only to unauthenticated probing (alert suppression), and valid
// traffic gets a volume tripwire that alerts but still processes.

export const REJECT_ALERT_MAX = 5; // alerts per source IP per window for unauthenticated rejections
export const REJECT_WINDOW_SECONDS = 600;
export const SUPPRESSED_NOTICE_MAX = 1; // one "alerts suppressed" notice per source IP per window
export const VOLUME_MAX = 300; // valid events per school per window before the tripwire alerts
export const VOLUME_WINDOW_SECONDS = 600;
export const VOLUME_ALERT_MAX = 1; // one volume alert per school per hour
export const VOLUME_ALERT_WINDOW_SECONDS = 3600;

/** Normalises a source IP for use inside a bucket name (never empty, bounded length). */
export function ipKey(ip: string | null | undefined): string {
  const v = (ip ?? "").trim().toLowerCase();
  if (!v) return "unknown";
  return v.replace(/[^0-9a-f:.]/g, "?").slice(0, 64);
}

export const rejectBucket = (ip: string | null | undefined) => `c2b-reject:${ipKey(ip)}`;
export const suppressedNoticeBucket = (ip: string | null | undefined) => `c2b-reject-notice:${ipKey(ip)}`;
export const volumeBucket = (schoolId: string) => `c2b-volume:${schoolId}`;
export const volumeAlertBucket = (schoolId: string) => `c2b-volume-alert:${schoolId}`;

/**
 * Reads the RPC answer. Fails OPEN: only an explicit `false` means "over the limit". A database error,
 * a missing answer or any other value must never block or silence anything.
 */
export function isWithinLimit(data: unknown, error: unknown): boolean {
  if (error) return true;
  return data !== false;
}
