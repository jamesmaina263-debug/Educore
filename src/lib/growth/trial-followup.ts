// Trial follow-up: which trial schools need a human check-in, and why.
//
// Pure and time-injectable so every rule is unit-tested. Inputs are SCHOOL-LEVEL facts only (trial dates,
// last sign-in/seen time, number of staff accounts, the owner's name and email): never learner data. The
// output is a prioritised list of SUGGESTIONS for a person. Nothing here sends a message, changes a
// subscription or offers a discount; whether and how to follow up is always a human decision.
//
// Checkpoint days and thresholds are suggested defaults, not rules: change the constants below.

import { isRecentlyCheckedIn, type SchoolCheckinSummary } from "./trial-checkins";

export const CHECKPOINT_DAYS: readonly number[] = [1, 3, 7, 14, 21, 27, 30];
/** From this trial day on, "no activity" and "no staff yet" are meaningful (day 1-2 is just starting). */
export const SETUP_CHECKS_FROM_DAY = 3;
export const INACTIVE_AFTER_DAYS = 3;
export const EXPIRING_WITHIN_DAYS = 3;
export const RECENTLY_EXPIRED_DAYS = 14;

const DAY_MS = 86_400_000;

export type TrialSchoolInput = {
  schoolId: string;
  name: string;
  slug: string;
  schoolStatus: string; // schools.status: trial | active | suspended | cancelled
  subscriptionStatus: string | null; // school_subscriptions.status
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  lastActiveAt: string | null;
  staffCount: number;
  owner: { name: string | null; email: string | null } | null;
  /** From the check-in log; absent/null = nobody has logged a check-in with this school. */
  checkin?: SchoolCheckinSummary | null;
};

export type AttentionReason = "expiring_soon" | "inactive" | "no_staff" | "checkpoint";

export type TrialRow = {
  schoolId: string;
  name: string;
  trialDay: number;
  totalDays: number;
  daysLeft: number;
  trialEndsAt: string;
  lastActiveAt: string | null;
  inactiveDays: number | null;
  staffCount: number;
  owner: { name: string | null; email: string | null } | null;
  checkin: SchoolCheckinSummary | null;
  /** Latest suggested checkpoint already reached, and the next one coming. */
  checkpoint: number | null;
  nextCheckpoint: number | null;
  reasons: AttentionReason[];
  reasonTexts: string[];
  suggestion: string | null;
};

export type TrialFollowup = {
  needsAttention: TrialRow[];
  /** Flagged trials that were checked in with in the last RECENT_CHECKIN_DAYS days, or whose owner asked to stop. */
  followedUp: TrialRow[];
  onTrack: TrialRow[];
  recentlyExpired: TrialRow[];
  summary: { running: number; needsAttention: number; followedUp: number; endingWithin7Days: number; recentlyExpired: number };
};

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Demo / QA tenants and reserved test addresses are never real customers (same rule the owner email campaigns use). */
export function isTestTenant(slug: string, ownerEmail: string | null | undefined): boolean {
  const s = slug.toLowerCase();
  if (s === "demo-academy" || s.startsWith("qa-")) return true;
  const e = (ownerEmail ?? "").toLowerCase().trim();
  return e.endsWith("@educore.test") || e.endsWith(".test");
}

const DAYS = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

const SUGGESTIONS: Record<AttentionReason, (r: { daysLeft: number; trialDay: number }) => string> = {
  expiring_soon: () => "Ask the owner what they still need before the trial ends, and what would help them continue.",
  inactive: () => "Check in and offer a short setup or training call.",
  no_staff: () => "Offer to help add staff accounts and get the first classes set up.",
  checkpoint: ({ trialDay }) => `Day ${trialDay} check-in: ask how setup is going and whether anything is blocking them.`,
};

const PRIORITY: Record<AttentionReason, number> = { expiring_soon: 100, inactive: 50, no_staff: 20, checkpoint: 10 };
const ORDER: AttentionReason[] = ["expiring_soon", "inactive", "no_staff", "checkpoint"];

function buildRow(s: TrialSchoolInput, now: number): TrialRow | null {
  const start = ms(s.trialStartedAt);
  const end = ms(s.trialEndsAt);
  if (start === null || end === null || end <= start) return null;

  const totalDays = Math.max(1, Math.round((end - start) / DAY_MS));
  const trialDay = Math.max(1, Math.floor((now - start) / DAY_MS) + 1);
  const daysLeft = Math.ceil((end - now) / DAY_MS);
  const active = ms(s.lastActiveAt);
  const inactiveDays = active === null ? null : Math.max(0, Math.floor((now - active) / DAY_MS));

  const checkpoints = CHECKPOINT_DAYS.filter((d) => d <= totalDays);
  const reached = checkpoints.filter((d) => d <= trialDay);
  const checkpoint = reached.length ? Math.max(...reached) : null;
  const upcoming = checkpoints.filter((d) => d > trialDay);
  const nextCheckpoint = upcoming.length ? Math.min(...upcoming) : null;

  const reasons: AttentionReason[] = [];
  const texts: Partial<Record<AttentionReason, string>> = {};
  if (daysLeft <= EXPIRING_WITHIN_DAYS) {
    reasons.push("expiring_soon");
    texts.expiring_soon = daysLeft <= 0 ? "Trial ends today or has already ended" : `Trial ends in ${DAYS(daysLeft)}`;
  }
  if (trialDay >= SETUP_CHECKS_FROM_DAY && (inactiveDays === null || inactiveDays >= INACTIVE_AFTER_DAYS)) {
    reasons.push("inactive");
    texts.inactive = inactiveDays === null ? "No sign-in or activity recorded" : `No activity for ${DAYS(inactiveDays)}`;
  }
  if (trialDay >= SETUP_CHECKS_FROM_DAY && s.staffCount <= 1) {
    reasons.push("no_staff");
    texts.no_staff = "Only one staff account so far: setup may not have started";
  }
  if (checkpoints.includes(trialDay)) {
    reasons.push("checkpoint");
    texts.checkpoint = `Day ${trialDay} check-in is due`;
  }
  const ordered = ORDER.filter((r) => reasons.includes(r));

  return {
    schoolId: s.schoolId,
    name: s.name,
    trialDay,
    totalDays,
    daysLeft,
    trialEndsAt: s.trialEndsAt as string,
    lastActiveAt: s.lastActiveAt,
    inactiveDays,
    staffCount: s.staffCount,
    owner: s.owner,
    checkin: s.checkin ?? null,
    checkpoint,
    nextCheckpoint,
    reasons: ordered,
    reasonTexts: ordered.map((r) => texts[r] as string),
    suggestion: ordered.length ? SUGGESTIONS[ordered[0]]({ daysLeft, trialDay }) : null,
  };
}

function priority(r: TrialRow): number {
  return r.reasons.reduce((n, x) => n + PRIORITY[x], 0);
}

export function buildTrialFollowup(inputs: readonly TrialSchoolInput[], nowDate: Date = new Date()): TrialFollowup {
  const now = nowDate.getTime();
  const running: TrialRow[] = [];
  const expired: TrialRow[] = [];

  for (const s of inputs) {
    if (isTestTenant(s.slug, s.owner?.email)) continue;
    const row = buildRow(s, now);
    if (!row) continue;

    if (s.schoolStatus === "trial" && s.subscriptionStatus === "trialing") {
      running.push(row);
    } else if (
      s.schoolStatus === "suspended" &&
      (s.subscriptionStatus === "past_due" || s.subscriptionStatus === "suspended")
    ) {
      const endedAgo = now - (ms(s.trialEndsAt) as number);
      if (endedAgo >= 0 && endedAgo <= RECENTLY_EXPIRED_DAYS * DAY_MS) expired.push(row);
    }
  }

  // A flagged school we already checked in with recently (or that asked not to be contacted) is not
  // suggested again: it is listed separately so a person can still see it.
  const held = (r: TrialRow) =>
    r.reasons.length > 0 && !!r.checkin && (r.checkin.askedToStop || isRecentlyCheckedIn(r.checkin.last.at, nowDate));
  const followedUp = running
    .filter(held)
    .sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name));
  const needsAttention = running
    .filter((r) => r.reasons.length > 0 && !held(r))
    .sort((a, b) => priority(b) - priority(a) || a.daysLeft - b.daysLeft || a.name.localeCompare(b.name));
  const onTrack = running
    .filter((r) => r.reasons.length === 0)
    .sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name));
  const recentlyExpired = expired.sort((a, b) => b.daysLeft - a.daysLeft || a.name.localeCompare(b.name));

  return {
    needsAttention,
    followedUp,
    onTrack,
    recentlyExpired,
    summary: {
      running: running.length,
      needsAttention: needsAttention.length,
      followedUp: followedUp.length,
      endingWithin7Days: running.filter((r) => r.daysLeft >= 0 && r.daysLeft <= 7).length,
      recentlyExpired: recentlyExpired.length,
    },
  };
}
