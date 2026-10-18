import { describe, expect, it } from "vitest";
import { assembleTrialInputs } from "./trial-followup-data";

const sub = (school_id: string, over = {}) => ({
  school_id,
  status: "trialing",
  trial_ends_at: "2026-11-01T00:00:00Z",
  created_at: "2026-10-02T00:00:00Z",
  ...over,
});
const school = (id: string, over = {}) => ({
  id,
  name: `School ${id}`,
  slug: `school-${id}`,
  status: "trial",
  created_at: "2026-10-01T00:00:00Z",
  ...over,
});

describe("assembleTrialInputs", () => {
  it("joins subscription, school, activity, staff count and owner", () => {
    const [r] = assembleTrialInputs({
      subscriptions: [sub("a")],
      schools: [school("a")],
      lastActive: [{ school_id: "a", last_active_at: "2026-10-17T08:00:00Z" }],
      users: [
        { school_id: "a", full_name: "Owner One", email: "owner@a.example", roles: { name: "school_owner" } },
        { school_id: "a", full_name: "Teacher", email: "t@a.example", roles: { name: "teacher" } },
        { school_id: "a", full_name: "Bursar", email: "b@a.example", roles: [{ name: "bursar" }] },
      ],
    });
    expect(r).toMatchObject({
      schoolId: "a",
      name: "School a",
      schoolStatus: "trial",
      subscriptionStatus: "trialing",
      trialStartedAt: "2026-10-02T00:00:00Z",
      trialEndsAt: "2026-11-01T00:00:00Z",
      lastActiveAt: "2026-10-17T08:00:00Z",
      staffCount: 3,
      owner: { name: "Owner One", email: "owner@a.example" },
    });
  });

  it("finds the owner whether the role comes back as an object or a one-element array", () => {
    const base = { subscriptions: [sub("a")], schools: [school("a")], lastActive: [] };
    const asObject = assembleTrialInputs({ ...base, users: [{ school_id: "a", full_name: "O", email: "o@x", roles: { name: "school_owner" } }] });
    const asArray = assembleTrialInputs({ ...base, users: [{ school_id: "a", full_name: "O", email: "o@x", roles: [{ name: "school_owner" }] }] });
    expect(asObject[0].owner).toEqual({ name: "O", email: "o@x" });
    expect(asArray[0].owner).toEqual({ name: "O", email: "o@x" });
  });

  it("keeps the first owner when there are several, and counts them all as staff", () => {
    const [r] = assembleTrialInputs({
      subscriptions: [sub("a")],
      schools: [school("a")],
      lastActive: [],
      users: [
        { school_id: "a", full_name: "First", email: "1@x", roles: { name: "school_owner" } },
        { school_id: "a", full_name: "Second", email: "2@x", roles: { name: "school_owner" } },
      ],
    });
    expect(r.owner?.name).toBe("First");
    expect(r.staffCount).toBe(2);
  });

  it("handles a school with no users, no activity and no owner", () => {
    const [r] = assembleTrialInputs({ subscriptions: [sub("a")], schools: [school("a")], lastActive: [], users: [] });
    expect(r.staffCount).toBe(0);
    expect(r.owner).toBeNull();
    expect(r.lastActiveAt).toBeNull();
  });

  it("keeps schools apart", () => {
    const rows = assembleTrialInputs({
      subscriptions: [sub("a"), sub("b")],
      schools: [school("a"), school("b")],
      lastActive: [{ school_id: "b", last_active_at: "2026-10-10T00:00:00Z" }],
      users: [
        { school_id: "a", full_name: "A", email: "a@x", roles: { name: "school_owner" } },
        { school_id: "b", full_name: "B1", email: "b1@x", roles: { name: "teacher" } },
        { school_id: "b", full_name: "B2", email: "b2@x", roles: { name: "teacher" } },
      ],
    });
    const a = rows.find((r) => r.schoolId === "a")!;
    const b = rows.find((r) => r.schoolId === "b")!;
    expect(a.staffCount).toBe(1);
    expect(a.lastActiveAt).toBeNull();
    expect(a.owner?.email).toBe("a@x");
    expect(b.staffCount).toBe(2);
    expect(b.owner).toBeNull(); // no owner row for B: not borrowed from A
    expect(b.lastActiveAt).toBe("2026-10-10T00:00:00Z");
  });

  it("starts the trial at the subscription's creation, falling back to the school's", () => {
    const [withSub] = assembleTrialInputs({ subscriptions: [sub("a")], schools: [school("a")], lastActive: [], users: [] });
    expect(withSub.trialStartedAt).toBe("2026-10-02T00:00:00Z");
    const [fallback] = assembleTrialInputs({
      subscriptions: [sub("a", { created_at: null })],
      schools: [school("a")],
      lastActive: [],
      users: [],
    });
    expect(fallback.trialStartedAt).toBe("2026-10-01T00:00:00Z");
  });

  it("drops a school that has no subscription row, and ignores a subscription whose school was not returned", () => {
    const rows = assembleTrialInputs({
      subscriptions: [sub("a"), sub("ghost")],
      schools: [school("a"), school("no-sub")],
      lastActive: [],
      users: [],
    });
    expect(rows.map((r) => r.schoolId)).toEqual(["a"]);
  });
});

describe("assembleTrialInputs check-ins", () => {
  const base = { subscriptions: [sub("a"), sub("b")], schools: [school("a"), school("b")], lastActive: [], users: [] };
  const summary = { last: { at: "2026-10-17T08:00:00Z", channel: "call", outcome: "no_answer", byName: null }, count: 1, askedToStop: false };

  it("attaches each school's own check-in summary and null when there is none", () => {
    const out = assembleTrialInputs({ ...base, checkins: new Map([["a", summary]]) });
    expect(out.find((r) => r.schoolId === "a")?.checkin).toEqual(summary);
    expect(out.find((r) => r.schoolId === "b")?.checkin).toBeNull();
  });
  it("works when no check-ins are supplied at all", () => {
    expect(assembleTrialInputs(base).every((r) => r.checkin === null)).toBe(true);
  });
});

