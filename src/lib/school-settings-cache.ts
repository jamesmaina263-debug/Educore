import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export interface SchoolSettings {
  name: string;
  expense_approval_threshold: number | null;
  fee_alert_threshold: number | null;
}

const DEFAULT_SETTINGS: SchoolSettings = { name: "EduCore", expense_approval_threshold: null, fee_alert_threshold: null };

/** Pass this exact string to revalidateTag() wherever `schools.name`,
 * `.expense_approval_threshold`, or `.fee_alert_threshold` is written (currently:
 * updateBranding in settings/actions.ts, setFeeAlertThresholdAction in finance/actions.ts), so a
 * change is visible on the very next request instead of waiting out the TTL below.
 *
 * One shared tag across every school, not a per-school tag -- deliberately. unstable_cache's
 * `tags` option is fixed at wrap-time, not re-computed per call; making it vary by schoolId would
 * mean re-wrapping on every invocation, and getting that wrong (tag computed at write-time not
 * matching the tag attached at read-time) fails silently -- the cache just never gets
 * invalidated, and there is no local way to verify that end-to-end without a live Next.js Data
 * Cache to test against. One static, easy-to-grep string is easy to get right and easy to verify
 * by inspection. The cost is real but small: any school editing its branding or fee-alert
 * threshold invalidates every school's cached settings, so the next request for any school
 * refetches once -- a single extra query per school, not an outage.
 */
export const SCHOOL_SETTINGS_CACHE_TAG = "school-settings";

/**
 * Cached read of a school's own settings row (name + the two approval-threshold columns).
 * These are fetched via a `school_users -> schools(...)` join on nearly every authenticated
 * page load in the app (dashboard, every Finance page, ...) even though they change only when
 * someone edits Settings or Fee Alert configuration -- a handful of times a year, if that.
 *
 * SAFETY -- read this before reusing this pattern elsewhere in the app: it is NOT safe to cache
 * most RLS-scoped tables this way. `terms`, `academic_years`, `classes`, `streams`, and
 * `subjects` all gate SELECT on `academics.read` in addition to `school_id` -- caching those by
 * school_id alone and serving the cached result to every session in that school would silently
 * bypass the permission check for any role that lacks academics.read (e.g. a guardian, or a
 * finance-only role), which is a privilege-escalation bug, not just a staleness one. `schools`
 * is different: its own-school SELECT branch is `id = auth_school_id()` with NO permission
 * gate -- any authenticated member of a school can see their own school's row, full stop -- so
 * using the admin client (bypassing RLS) plus an explicit `.eq("id", schoolId)` filter here
 * reproduces exactly what RLS would already return to any caller, for any role, every time.
 * Do not copy this pattern onto a table without checking its actual RLS quals first.
 *
 * 1-hour TTL as a defense-in-depth fallback even though every known write path already calls
 * revalidateTag -- if a future write path forgets to invalidate, staleness self-heals within an
 * hour instead of persisting indefinitely.
 */
export const getCachedSchoolSettings = unstable_cache(
  async (schoolId: string): Promise<SchoolSettings> => {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("schools")
      .select("name, expense_approval_threshold, fee_alert_threshold")
      .eq("id", schoolId)
      .maybeSingle();
    return data ?? DEFAULT_SETTINGS;
  },
  ["school-settings"],
  { tags: [SCHOOL_SETTINGS_CACHE_TAG], revalidate: 3600 },
);
