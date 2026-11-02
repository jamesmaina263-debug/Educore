// Server-side only: reads with the service-role client passed in and raises an operational alert.
// Kept apart from c2b-attention.ts, which a client component imports (importing sendSecurityAlert there
// pulled the server-only admin client into the client bundle and failed `next build`).
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendSecurityAlert } from "@/lib/security-alert";
import { MAX_STALE_ROWS, isFirstRunOfHour, staleCutoffIso, summariseStale, type StaleRow } from "@/lib/c2b-attention";

export interface StaleCheckResult {
  staleCount: number;
  alerted: boolean;
  checkFailed: boolean;
}

/**
 * Looks for events parked as `deferred_to_stk` for over an hour and raises one alert (Slack + the
 * platform_alerts digest) when any exist. Never throws: a failing check is reported, not fatal.
 * `throttleHourly` is for the every-15-minutes caller; the daily backstop passes false.
 */
export async function alertIfStale(
  admin: SupabaseClient,
  opts: { throttleHourly: boolean; now?: Date },
): Promise<StaleCheckResult> {
  const now = opts.now ?? new Date();
  const { data, error } = await admin
    .from("inbound_payment_events")
    .select("school_id, created_at")
    .eq("outcome", "deferred_to_stk")
    .lt("created_at", staleCutoffIso(now))
    .order("created_at", { ascending: true })
    .limit(MAX_STALE_ROWS);
  if (error) return { staleCount: 0, alerted: false, checkFailed: true };

  const summary = summariseStale((data ?? []) as StaleRow[], now);
  if (!summary) return { staleCount: 0, alerted: false, checkFailed: false };
  if (opts.throttleHourly && !isFirstRunOfHour(now)) {
    return { staleCount: summary.count, alerted: false, checkFailed: false };
  }

  await sendSecurityAlert("C2B payments stuck waiting for STK confirmation", {
    events: summary.capped ? `${summary.count}+` : String(summary.count),
    schools: String(summary.schools),
    oldest_minutes: String(summary.oldestMinutes),
    action:
      "Check the c2b-resolve-deferred-cron workflow in GitHub Actions and Finance > Paybill for the school. Money may be received but not recorded.",
  });
  return { staleCount: summary.count, alerted: true, checkFailed: false };
}
