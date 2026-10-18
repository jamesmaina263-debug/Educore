import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_DAYS,
  buildTrialFollowup,
  isTestTenant,
  type TrialSchoolInput,
} from "./trial-followup";

const NOW = new Date("2026-10-18T09:00:00Z");
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * DAY).toISOString();

/** A 30-day trial that is currently on trial day `day` (day 1 = the first 24 hours). */
function trial(day: number, over: Partial<TrialSchoolInput> = {}): TrialSchoolInput {
  return {
    schoolId: over.schoolId ?? `s-${day}`,
    name: over.name ?? `School ${day}`,
    slug: over.slug ?? `school-${day}`,
    schoolStatus: "trial",
    subscriptionStatus: "trialing",
    trialStartedAt: iso(-(day - 1) - 0.1),
    trialEndsAt: iso(-(day - 1) - 0.1 + 30),
    lastActiveAt: iso(-0.2), // active a few hours ago
    staffCount: 4,
    owner: { name: "Jane Owner", email: "jane@school.example" },
    ...over,
  };
}

const run = (...s: TrialSchoolInput[]) => buildTrialFollowup(s, NOW);

describe("trial day and days left", () => {
  it("counts day 1 as the first 24 hours and rounds days left up", () => {
    const r = run(trial(1)).onTrack[0] ?? run(trial(1)).needsAttention[0];
    expect(r.trialDay).toBe(1);
    expect(r.totalDays).toBe(30);
    expect(r.daysLeft).toBe(30); // 29.9 days remain, rounded up
    const r10 = run(trial(10)).onTrack[0];
    expect(r10.trialDay).toBe(10);
    expect(r10.daysLeft).toBe(21);
  });

  it("tracks the latest and next suggested checkpoint", () => {
    const r = run(trial(10)).onTrack[0];
    expect(r.checkpoint).toBe(7);
    expect(r.nextCheckpoint).toBe(14);
  });
});

describe("what puts a trial school on the attention list", () => {
  it("leaves a healthy mid-trial school alone", () => {
    const f = run(trial(10));
    expect(f.needsAttention).toHaveLength(0);
    expect(f.onTrack).toHaveLength(1);
    expect(f.onTrack[0].suggestion).toBeNull();
  });

  it("flags a trial that ends within 3 days, but not at 4", () => {
    const at3 = run(trial(28)).needsAttention[0];
    expect(at3.reasons).toContain("expiring_soon");
    expect(at3.reasonTexts.join(" ")).toMatch(/ends in 3 days/);
    expect(run(trial(26)).needsAttention.some((r) => r.reasons.includes("expiring_soon"))).toBe(false);
  });

  it("words a trial that has run out", () => {
    const ended = trial(31, { trialEndsAt: iso(-0.5), trialStartedAt: iso(-29.5) });
    const r = run(ended).needsAttention[0];
    expect(r.reasonTexts[0]).toMatch(/ends today or has already ended/);
  });

  it("flags inactivity from day 3 at 3+ days, and a school with no recorded activity", () => {
    const quiet = run(trial(9, { lastActiveAt: iso(-3.2) })).needsAttention[0];
    expect(quiet.reasons).toContain("inactive");
    expect(quiet.reasonTexts.join(" ")).toMatch(/No activity for 3 days/);
    expect(run(trial(9, { lastActiveAt: iso(-2.5) })).needsAttention).toHaveLength(0);
    const never = run(trial(9, { lastActiveAt: null })).needsAttention[0];
    expect(never.reasonTexts.join(" ")).toMatch(/No sign-in or activity recorded/);
  });

  it("does not call a brand-new trial inactive (days 1 and 2)", () => {
    expect(run(trial(2, { lastActiveAt: null })).needsAttention.some((r) => r.reasons.includes("inactive"))).toBe(false);
    expect(run(trial(3, { lastActiveAt: null })).needsAttention[0].reasons).toContain("inactive");
  });

  it("flags a school with only one staff account from day 3", () => {
    expect(run(trial(9, { staffCount: 1 })).needsAttention[0].reasons).toContain("no_staff");
    expect(run(trial(9, { staffCount: 0 })).needsAttention[0].reasons).toContain("no_staff");
    expect(run(trial(9, { staffCount: 2 })).needsAttention).toHaveLength(0);
    expect(run(trial(2, { staffCount: 1 })).needsAttention).toHaveLength(0);
  });

  it("flags a school on a suggested checkpoint day", () => {
    for (const d of [3, 7, 14, 21]) {
      const r = run(trial(d)).needsAttention[0];
      expect(r.reasons).toEqual(["checkpoint"]);
      expect(r.suggestion).toMatch(new RegExp(`Day ${d} check-in`));
    }
    expect(run(trial(8)).needsAttention).toHaveLength(0);
  });

  it("ignores checkpoints longer than the trial itself", () => {
    const short = trial(7, { trialEndsAt: iso(-6.1 + 14) }); // a 14-day trial, on day 7
    const f = run(short);
    expect(f.needsAttention[0].totalDays).toBe(14);
    expect(f.needsAttention[0].nextCheckpoint).toBe(14);
    expect(CHECKPOINT_DAYS).toContain(30);
  });
});

describe("ordering and suggestions", () => {
  it("puts the most urgent school first, then the soonest to end", () => {
    const urgent = trial(28, { schoolId: "urgent", name: "Urgent", lastActiveAt: iso(-5) }); // expiring + inactive
    const expiringOnly = trial(29, { schoolId: "exp", name: "Expiring" });
    const quiet = trial(9, { schoolId: "quiet", name: "Quiet", lastActiveAt: iso(-6) }); // inactive only
    const f = run(quiet, expiringOnly, urgent);
    expect(f.needsAttention.map((r) => r.schoolId)).toEqual(["urgent", "exp", "quiet"]);
  });

  it("suggests an action for the top reason only, and never promises to send anything", () => {
    const r = run(trial(28, { lastActiveAt: iso(-5) })).needsAttention[0];
    expect(r.reasons[0]).toBe("expiring_soon");
    expect(r.suggestion).toMatch(/before the trial ends/);
    for (const row of [r, run(trial(7)).needsAttention[0]]) {
      expect(row.suggestion).not.toMatch(/discount|free month|we will send|automatically/i);
    }
  });
});

describe("summary", () => {
  it("counts running trials, attention, ending within 7 days and recent expiries", () => {
    const f = run(
      trial(10, { schoolId: "a" }),
      trial(9, { schoolId: "b", lastActiveAt: iso(-8) }),
      trial(25, { schoolId: "c" }), // 5-6 days left
      trial(30, { schoolId: "d" }), // 1 day left
    );
    expect(f.summary.running).toBe(4);
    // b is inactive and d ends tomorrow; a is healthy and c (6 days left, day 25) is neither on a checkpoint nor close enough
    expect(f.summary.needsAttention).toBe(2);
    expect(f.needsAttention.map((r) => r.schoolId).sort()).toEqual(["b", "d"]);
    expect(f.summary.endingWithin7Days).toBe(2); // c (6 days) and d (1 day)
  });
});

describe("recently expired (not converted)", () => {
  const expired = (daysAgo: number, over: Partial<TrialSchoolInput> = {}): TrialSchoolInput => ({
    ...trial(30),
    schoolId: over.schoolId ?? "x",
    schoolStatus: "suspended",
    subscriptionStatus: "past_due",
    trialStartedAt: iso(-daysAgo - 30),
    trialEndsAt: iso(-daysAgo),
    ...over,
  });

  it("lists a suspended school whose trial ended in the last 14 days", () => {
    const f = run(expired(5));
    expect(f.recentlyExpired).toHaveLength(1);
    expect(f.summary.recentlyExpired).toBe(1);
    expect(f.recentlyExpired[0].daysLeft).toBeLessThanOrEqual(-5);
  });

  it("drops it after 14 days, and never lists active, cancelled or still-trialing schools", () => {
    expect(run(expired(15)).recentlyExpired).toHaveLength(0);
    expect(run(expired(5, { schoolStatus: "active", subscriptionStatus: "active" })).recentlyExpired).toHaveLength(0);
    expect(run(expired(5, { schoolStatus: "suspended", subscriptionStatus: "cancelled" })).recentlyExpired).toHaveLength(0);
    expect(run(expired(5, { schoolStatus: "trial", subscriptionStatus: "trialing" })).recentlyExpired).toHaveLength(0);
  });

  it("does not chase a school that has already been reactivated, even if its subscription row lags", () => {
    // school is active again but the subscription still says past_due: it must not appear in the win-back list
    expect(run(expired(5, { schoolStatus: "active", subscriptionStatus: "past_due" })).recentlyExpired).toHaveLength(0);
    expect(run(expired(5, { schoolStatus: "active", subscriptionStatus: "suspended" })).recentlyExpired).toHaveLength(0);
  });
});

describe("exclusions and bad data", () => {
  it("never lists demo / QA tenants or reserved test addresses", () => {
    expect(isTestTenant("demo-academy", null)).toBe(true);
    expect(isTestTenant("QA-Smoke", null)).toBe(true);
    expect(isTestTenant("real-school", "x@educore.test")).toBe(true);
    expect(isTestTenant("real-school", "x@something.test")).toBe(true);
    expect(isTestTenant("real-school", "head@school.ac.ke")).toBe(false);
    const f = run(
      trial(9, { slug: "demo-academy", lastActiveAt: iso(-9) }),
      trial(9, { slug: "qa-1", lastActiveAt: iso(-9) }),
      trial(9, { owner: { name: "T", email: "t@educore.test" }, lastActiveAt: iso(-9) }),
    );
    expect(f.summary.running).toBe(0);
  });

  it("skips rows with missing or invalid dates instead of throwing", () => {
    const f = run(
      trial(9, { trialStartedAt: null }),
      trial(9, { trialEndsAt: null }),
      trial(9, { trialStartedAt: "not a date" }),
      trial(9, { trialEndsAt: iso(-100) }), // ends before it starts
    );
    expect(f.summary.running).toBe(0);
  });

  it("handles a school with no owner on file", () => {
    const r = run(trial(9, { owner: null, lastActiveAt: iso(-9) })).needsAttention[0];
    expect(r.owner).toBeNull();
  });
});

describe("check-ins keep the same school from being chased twice", () => {
  const checkin = (daysAgo: number, outcome = "no_answer", askedToStop = false) => ({
    last: { at: iso(-daysAgo), channel: "call", outcome, byName: "Ben" },
    count: 1,
    askedToStop,
  });
  // Day 10, owner inactive for a week: flagged "inactive".
  const flagged = (c?: ReturnType<typeof checkin> | null) =>
    trial(10, { schoolId: "x", name: "X School", lastActiveAt: iso(-7), checkin: c });

  it("still needs a check-in when nobody has logged one", () => {
    const f = run(flagged(null));
    expect(f.needsAttention.map((r) => r.schoolId)).toEqual(["x"]);
    expect(f.followedUp).toEqual([]);
  });
  it("moves a flagged school out of the list when it was checked in with recently, but still shows it", () => {
    const f = run(flagged(checkin(1)));
    expect(f.needsAttention).toEqual([]);
    expect(f.followedUp.map((r) => r.schoolId)).toEqual(["x"]);
    expect(f.followedUp[0].reasons).toContain("inactive");
    expect(f.summary).toMatchObject({ running: 1, needsAttention: 0, followedUp: 1 });
  });
  it("suggests the school again once the wait is over", () => {
    expect(run(flagged(checkin(2.9))).followedUp).toHaveLength(1);
    const f = run(flagged(checkin(3.1)));
    expect(f.needsAttention.map((r) => r.schoolId)).toEqual(["x"]);
    expect(f.followedUp).toEqual([]);
  });
  it("never suggests a school that asked not to be contacted, however old the check-in", () => {
    const f = run(flagged(checkin(20, "asked_to_stop", true)));
    expect(f.needsAttention).toEqual([]);
    expect(f.followedUp.map((r) => r.schoolId)).toEqual(["x"]);
  });
  it("leaves unflagged schools where they were and carries the last check-in through", () => {
    const f = run(trial(10, { schoolId: "ok", checkin: checkin(1) }));
    expect(f.onTrack[0].checkin?.last.outcome).toBe("no_answer");
    expect(f.followedUp).toEqual([]);
  });
});
