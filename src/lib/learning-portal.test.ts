import { describe, it, expect } from "vitest";
import {
  blankQuestion,
  bestAttempt,
  isHttpsUrl,
  isUpcomingLesson,
  percent,
  questionsPayload,
  quizStats,
  validateQuiz,
  validateResource,
  type QuizInput,
  type ResourceInput,
} from "./learning-portal";

const res: ResourceInput = {
  id: null, streamId: "s", subjectId: "j", kind: "video", title: " Fractions ", body: "", url: "https://example.com/v",
  startsAt: "", paperYear: "", published: true,
};
const q = { prompt: "2+2?", options: ["4", "5"], correctIndex: 0, marks: 1 };
const quiz: QuizInput = {
  id: null, streamId: "s", subjectId: "j", title: " Week 1 ", description: "", maxAttempts: 1, showAnswers: false,
  status: "draft", questions: [q],
};

describe("links", () => {
  it("accepts only https links without spaces", () => {
    expect(isHttpsUrl("https://example.com/a?b=1")).toBe(true);
    expect(isHttpsUrl("http://example.com")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("https://exa mple.com")).toBe(false);
    expect(isHttpsUrl("https://" + "a".repeat(500))).toBe(false);
  });
});

describe("validateResource", () => {
  it("trims the title and accepts a good video", () => {
    const r = validateResource(res);
    expect("value" in r && r.value.title).toBe("Fractions");
  });
  it("needs a note body for notes and a link for everything else", () => {
    expect("error" in validateResource({ ...res, kind: "note", url: "", body: "" })).toBe(true);
    expect("error" in validateResource({ ...res, kind: "note", url: "", body: "Text" })).toBe(false);
    expect("error" in validateResource({ ...res, url: "" })).toBe(true);
    expect("error" in validateResource({ ...res, url: "http://x.com" })).toBe(true);
  });
  it("needs a start time for live lessons and a sane year for past papers", () => {
    expect("error" in validateResource({ ...res, kind: "live_lesson" })).toBe(true);
    expect("error" in validateResource({ ...res, kind: "live_lesson", startsAt: "2026-11-10T09:00" })).toBe(false);
    expect("error" in validateResource({ ...res, kind: "past_paper", paperYear: "1800" })).toBe(true);
    expect("error" in validateResource({ ...res, kind: "past_paper", paperYear: "2019" })).toBe(false);
    expect("error" in validateResource({ ...res, kind: "past_paper", paperYear: "" })).toBe(false);
  });
  it("needs a class, subject and title", () => {
    expect("error" in validateResource({ ...res, streamId: "" })).toBe(true);
    expect("error" in validateResource({ ...res, subjectId: "" })).toBe(true);
    expect("error" in validateResource({ ...res, title: "  " })).toBe(true);
  });
});

describe("validateQuiz", () => {
  it("accepts a good quiz and trims the title", () => {
    const r = validateQuiz(quiz);
    expect("value" in r && r.value.title).toBe("Week 1");
  });
  it("rejects bad questions with the question number", () => {
    const bad = (qq: object) => validateQuiz({ ...quiz, questions: [{ ...q, ...qq }] });
    expect(bad({ prompt: " " })).toEqual({ error: "Question 1 needs a question (1000 characters at most)." });
    expect("error" in bad({ options: ["only"] })).toBe(true);
    expect("error" in bad({ options: ["a", " "] })).toBe(true);
    expect("error" in bad({ correctIndex: 2 })).toBe(true);
    expect("error" in bad({ marks: 11 })).toBe(true);
    expect("error" in bad({ options: ["1", "2", "3", "4", "5", "6", "7"] })).toBe(true);
  });
  it("needs questions on a new quiz but lets an existing one keep its own", () => {
    expect("error" in validateQuiz({ ...quiz, questions: [] })).toBe(true);
    expect("error" in validateQuiz({ ...quiz, questions: null })).toBe(true);
    expect("error" in validateQuiz({ ...quiz, id: "abc", questions: null })).toBe(false);
  });
  it("bounds attempts and question count", () => {
    expect("error" in validateQuiz({ ...quiz, maxAttempts: 0 })).toBe(true);
    expect("error" in validateQuiz({ ...quiz, maxAttempts: 11 })).toBe(true);
    expect("error" in validateQuiz({ ...quiz, questions: Array.from({ length: 51 }, () => q) })).toBe(true);
  });
  it("builds the payload the database expects", () => {
    expect(questionsPayload([{ ...q, prompt: " 2+2? ", options: [" 4 ", "5"] }])).toEqual([
      { prompt: "2+2?", options: ["4", "5"], correct_index: 0, marks: 1 },
    ]);
    expect(blankQuestion().options).toHaveLength(2);
  });
});

describe("results", () => {
  it("rounds percentages and handles zero totals", () => {
    expect(percent(3, 4)).toBe(75);
    expect(percent(1, 3)).toBe(33);
    expect(percent(0, 0)).toBe(0);
  });
  it("summarises attempts across learners", () => {
    expect(quizStats([])).toEqual({ attempts: 0, learners: 0, averagePercent: null });
    expect(
      quizStats([
        { quizId: "q", studentId: "a", score: 1, total: 2 },
        { quizId: "q", studentId: "a", score: 2, total: 2 },
        { quizId: "q", studentId: "b", score: 0, total: 2 },
      ]),
    ).toEqual({ attempts: 3, learners: 2, averagePercent: 50 });
  });
  it("finds the best attempt", () => {
    expect(bestAttempt([])).toBeNull();
    expect(bestAttempt([{ score: 1, total: 4 }, { score: 3, total: 4 }, { score: 2, total: 4 }])).toEqual({ score: 3, total: 4 });
  });
});

describe("upcoming lessons", () => {
  const now = new Date("2026-11-10T09:30:00Z");
  it("stays upcoming until an hour after the start", () => {
    expect(isUpcomingLesson("2026-11-10T10:00:00Z", now)).toBe(true);
    expect(isUpcomingLesson("2026-11-10T08:45:00Z", now)).toBe(true);
    expect(isUpcomingLesson("2026-11-10T08:00:00Z", now)).toBe(false);
    expect(isUpcomingLesson("garbage", now)).toBe(false);
  });
});
