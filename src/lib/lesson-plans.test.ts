import { describe, expect, it } from "vitest";
import { EMPTY_PLAN, coverage, statusLabel, validatePlan } from "./lesson-plans";

describe("validatePlan", () => {
  it("accepts an empty draft", () => {
    expect("value" in validatePlan(EMPTY_PLAN)).toBe(true);
  });
  it("requires a date when taught and drops it otherwise", () => {
    expect("error" in validatePlan({ ...EMPTY_PLAN, status: "taught" })).toBe(true);
    expect("error" in validatePlan({ ...EMPTY_PLAN, status: "taught", taughtOn: "2 Nov" })).toBe(true);
    const ok = validatePlan({ ...EMPTY_PLAN, status: "taught", taughtOn: "2026-11-02" });
    expect("value" in ok && ok.value.taughtOn).toBe("2026-11-02");
    const draft = validatePlan({ ...EMPTY_PLAN, status: "ready", taughtOn: "2026-11-02" });
    expect("value" in draft && draft.value.taughtOn).toBeNull();
  });
  it("checks duration and length", () => {
    expect("error" in validatePlan({ ...EMPTY_PLAN, durationMinutes: 4 })).toBe(true);
    expect("error" in validatePlan({ ...EMPTY_PLAN, durationMinutes: 241 })).toBe(true);
    expect("error" in validatePlan({ ...EMPTY_PLAN, durationMinutes: 40.5 })).toBe(true);
    expect("value" in validatePlan({ ...EMPTY_PLAN, durationMinutes: 40 })).toBe(true);
    expect("error" in validatePlan({ ...EMPTY_PLAN, objectives: "x".repeat(4001) })).toBe(true);
  });
});

describe("coverage", () => {
  it("counts planned, ready and taught", () => {
    expect(
      coverage([
        { entryId: "a", planStatus: null },
        { entryId: "b", planStatus: "draft" },
        { entryId: "c", planStatus: "ready" },
        { entryId: "d", planStatus: "taught" },
      ]),
    ).toEqual({ total: 4, planned: 3, ready: 1, taught: 1 });
    expect(statusLabel(null)).toBe("No plan yet");
    expect(statusLabel("taught")).toBe("Taught");
  });
});
