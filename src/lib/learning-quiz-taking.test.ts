import { describe, expect, it } from "vitest";
import { attemptsLeft, bestOf, buildAnswers, formatScore, parseSubmitResult, unansweredCount } from "./learning-quiz-taking";

describe("buildAnswers", () => {
  it("keeps valid picks and nulls everything else", () => {
    expect(buildAnswers([0, 2, undefined, 9, -1, 1.5], [4, 4, 4, 4, 4, 4])).toEqual([0, 2, null, null, null, null]);
  });
  it("always returns one entry per question", () => {
    expect(buildAnswers([], [2, 3, 4])).toEqual([null, null, null]);
    expect(unansweredCount([0, null, null])).toBe(2);
  });
});

describe("attempts and scores", () => {
  const a = [
    { attemptNo: 1, score: 3, total: 10 },
    { attemptNo: 2, score: 8, total: 10 },
  ];
  it("counts attempts left and never goes negative", () => {
    expect(attemptsLeft(3, a)).toBe(1);
    expect(attemptsLeft(2, a)).toBe(0);
    expect(attemptsLeft(1, a)).toBe(0);
  });
  it("finds the best attempt by percentage", () => {
    expect(bestOf(a)?.attemptNo).toBe(2);
    expect(bestOf([])).toBeNull();
    expect(bestOf([{ attemptNo: 1, score: 0, total: 0 }])).toBeNull();
  });
  it("formats a score", () => {
    expect(formatScore(8, 10)).toBe("8/10 (80%)");
    expect(formatScore(0, 0)).toBe("—");
  });
});

describe("parseSubmitResult", () => {
  it("parses the database result with and without a review", () => {
    expect(parseSubmitResult({ attempt_no: 1, score: 2, total: 3, attempts_left: 1, review: null })).toEqual({ attemptNo: 1, score: 2, total: 3, attemptsLeft: 1, review: null });
    const r = parseSubmitResult({ attempt_no: 1, score: 1, total: 2, attempts_left: 0, review: [{ position: 1, correct_index: 2, your_answer: null }, { bad: true }] });
    expect(r?.review).toEqual([{ position: 1, correctIndex: 2, yourAnswer: null }]);
  });
  it("rejects malformed results", () => {
    expect(parseSubmitResult(null)).toBeNull();
    expect(parseSubmitResult({ score: 1 })).toBeNull();
  });
});
