// Turns the raw rows the Trial follow-up page reads (all existing tables) into TrialSchoolInput objects.
// Pure so the joining rules are unit-tested: which user is "the owner", who counts as staff, what happens
// when a row is missing. School-level facts only.

import type { TrialSchoolInput } from "./trial-followup";
import type { SchoolCheckinSummary } from "./trial-checkins";

export type SubscriptionRow = { school_id: string; status: string; trial_ends_at: string | null; created_at: string | null };
export type SchoolRow = { id: string; name: string; slug: string; status: string; created_at: string | null };
export type LastActiveRow = { school_id: string; last_active_at: string | null };
/** `roles` is an object or a one-element array depending on how PostgREST shapes the embedded join. */
export type SchoolUserRow = {
  school_id: string;
  full_name: string | null;
  email: string | null;
  roles: { name: string } | { name: string }[] | null;
};

function roleName(r: SchoolUserRow["roles"]): string | undefined {
  return Array.isArray(r) ? r[0]?.name : (r?.name ?? undefined);
}

export function assembleTrialInputs(args: {
  subscriptions: readonly SubscriptionRow[];
  schools: readonly SchoolRow[];
  lastActive: readonly LastActiveRow[];
  users: readonly SchoolUserRow[];
  /** Per-school check-in summaries (see summariseCheckins). Optional: no log means no check-ins. */
  checkins?: ReadonlyMap<string, SchoolCheckinSummary>;
}): TrialSchoolInput[] {
  const lastActive = new Map(args.lastActive.map((r) => [r.school_id, r.last_active_at]));
  const subBySchool = new Map(args.subscriptions.map((s) => [s.school_id, s]));

  const staff = new Map<string, number>();
  const owners = new Map<string, { name: string | null; email: string | null }>();
  for (const u of args.users) {
    // Callers pass only non-parent / non-student / non-platform-admin users, so every row is a staff account.
    staff.set(u.school_id, (staff.get(u.school_id) ?? 0) + 1);
    if (roleName(u.roles) === "school_owner" && !owners.has(u.school_id)) {
      owners.set(u.school_id, { name: u.full_name, email: u.email });
    }
  }

  const out: TrialSchoolInput[] = [];
  for (const sc of args.schools) {
    const sub = subBySchool.get(sc.id);
    if (!sub) continue; // a school with no subscription row is not on a trial
    out.push({
      schoolId: sc.id,
      name: sc.name,
      slug: sc.slug,
      schoolStatus: sc.status,
      subscriptionStatus: sub.status,
      // A trial starts when its subscription row is created; fall back to the school's creation time.
      trialStartedAt: sub.created_at ?? sc.created_at,
      trialEndsAt: sub.trial_ends_at,
      lastActiveAt: lastActive.get(sc.id) ?? null,
      staffCount: staff.get(sc.id) ?? 0,
      owner: owners.get(sc.id) ?? null,
      checkin: args.checkins?.get(sc.id) ?? null,
    });
  }
  return out;
}
