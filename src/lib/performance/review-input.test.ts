import { describe, it, expect } from "vitest";
import { validateReviewInput } from "./review-input";

const base = {
  academic_year_id: "year-1",
  term_id: "term-1",
  review_type: "termly" as const,
  teacher_id: "teacher-1",
  competency_scores: { "Classroom management": 4 } as Record<string, unknown>,
  notes: "",
};

describe("validateReviewInput", () => {
  it("accepts scores within 1-5 (boundaries included) and trims notes", () => {
    const result = validateReviewInput({ ...base, competency_scores: { A: 1, B: 5, C: 3.5 }, notes: "  Solid term.  " });
    expect(result).toEqual({ competency_scores: { A: 1, B: 5, C: 3.5 }, notes: "Solid term." });
  });

  it.each([0, 6, 9, -3, Number.NaN, Number.POSITIVE_INFINITY])("rejects an out-of-range or non-finite score (%s)", (bad) => {
    const result = validateReviewInput({ ...base, competency_scores: { Punctuality: bad } });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("Punctuality");
  });

  it("rejects non-number score values", () => {
    expect(validateReviewInput({ ...base, competency_scores: { Punctuality: "4" } })).toHaveProperty("error");
  });

  it("requires at least one score or a note", () => {
    expect(validateReviewInput({ ...base, competency_scores: {}, notes: "   " })).toEqual({ error: "Enter at least one competency score or a note." });
    expect(validateReviewInput({ ...base, competency_scores: {}, notes: "Observed two lessons." })).toHaveProperty("competency_scores");
  });

  it("gives a clear message when there is no active academic year instead of a uuid cast error", () => {
    expect(validateReviewInput({ ...base, academic_year_id: "" })).toEqual({ error: "There is no active academic year to attach this review to." });
  });

  it("requires a term for termly reviews but not annual ones", () => {
    expect(validateReviewInput({ ...base, term_id: null })).toEqual({ error: "Select a term for a termly review." });
    expect(validateReviewInput({ ...base, review_type: "annual", term_id: null })).toHaveProperty("competency_scores");
  });

  it("requires a staff member", () => {
    expect(validateReviewInput({ ...base, teacher_id: "" })).toEqual({ error: "Select a staff member." });
  });
});
