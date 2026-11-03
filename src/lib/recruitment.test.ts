import { describe, it, expect } from "vitest";
import {
  NEXT_STAGES,
  STAGES,
  canMove,
  countByStage,
  isClosingSoon,
  isPastClosing,
  openingProgress,
  validateCandidate,
  validateMove,
  validateOpening,
  type OpeningInput,
} from "./recruitment";

const opening: OpeningInput = {
  id: null, title: "  Maths teacher ", department: "", employmentType: "full_time",
  description: "", positions: 2, closesOn: "2026-12-01", status: "open",
};

describe("stage rules (mirror the database)", () => {
  it("allows one step forward or out from a live stage", () => {
    expect(canMove("applied", "shortlisted")).toBe(true);
    expect(canMove("applied", "rejected")).toBe(true);
    expect(canMove("applied", "offer")).toBe(false);
    expect(canMove("offer", "hired")).toBe(true);
  });
  it("treats hired, rejected and withdrawn as final", () => {
    for (const s of ["hired", "rejected", "withdrawn"] as const) expect(NEXT_STAGES[s]).toEqual([]);
  });
  it("defines a rule for every stage", () => {
    expect(Object.keys(NEXT_STAGES).sort()).toEqual([...STAGES].sort());
  });
  it("needs a reason to reject", () => {
    expect(validateMove("applied", "rejected", "  ")).toEqual({ error: "Give a reason when rejecting a candidate." });
    expect(validateMove("applied", "rejected", "Not qualified")).toEqual({ ok: true });
    expect("error" in validateMove("hired", "rejected", "x")).toBe(true);
  });
});

describe("validateOpening", () => {
  it("trims the title and accepts a good opening", () => {
    const r = validateOpening(opening);
    expect("value" in r && r.value.title).toBe("Maths teacher");
  });
  it("rejects bad input", () => {
    expect("error" in validateOpening({ ...opening, title: "   " })).toBe(true);
    expect("error" in validateOpening({ ...opening, positions: 0 })).toBe(true);
    expect("error" in validateOpening({ ...opening, positions: 1.5 })).toBe(true);
    expect("error" in validateOpening({ ...opening, closesOn: "01/12/2026" })).toBe(true);
    expect("error" in validateOpening({ ...opening, description: "x".repeat(4001) })).toBe(true);
  });
});

describe("validateCandidate", () => {
  const c = { openingId: "o1", fullName: " Alice ", email: "", phone: "", source: "" };
  it("allows a missing email and trims the name", () => {
    const r = validateCandidate(c);
    expect("value" in r && r.value.fullName).toBe("Alice");
  });
  it("rejects a bad email, a missing opening and an empty name", () => {
    expect("error" in validateCandidate({ ...c, email: "not-an-email" })).toBe(true);
    expect("error" in validateCandidate({ ...c, openingId: "" })).toBe(true);
    expect("error" in validateCandidate({ ...c, fullName: " " })).toBe(true);
  });
});

describe("progress", () => {
  const cs = [
    { id: "1", openingId: "o", stage: "hired" as const },
    { id: "2", openingId: "o", stage: "interview" as const },
    { id: "3", openingId: "o", stage: "rejected" as const },
  ];
  it("counts stages including zeros", () => {
    expect(countByStage(cs)).toMatchObject({ hired: 1, interview: 1, rejected: 1, applied: 0, offer: 0 });
  });
  it("summarises an opening and flags when hires reach the positions", () => {
    expect(openingProgress(2, cs)).toEqual({ total: 3, live: 1, hired: 1, positions: 2, complete: false });
    expect(openingProgress(1, cs).complete).toBe(true);
  });
});

describe("closing dates", () => {
  it("flags openings closing within a week, and ones already past", () => {
    expect(isClosingSoon("2026-11-06", "open", "2026-11-03")).toBe(true);
    expect(isClosingSoon("2026-11-20", "open", "2026-11-03")).toBe(false);
    expect(isClosingSoon("2026-11-06", "closed", "2026-11-03")).toBe(false);
    expect(isPastClosing("2026-11-01", "open", "2026-11-03")).toBe(true);
    expect(isPastClosing("2026-11-01", "closed", "2026-11-03")).toBe(false);
  });
});
