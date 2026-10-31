import { describe, expect, it } from "vitest";
import {
  addSummaries,
  cardStatusOf,
  classHealthOf,
  filterStreamGroups,
  studentMatchesQuery,
  summariseClassStatus,
  summariseStream,
  type StreamGroup,
  type StudentSummary,
} from "./report-card-status";

const student = (over: Partial<StudentSummary>): StudentSummary => ({
  student_id: "s",
  full_name: "Jane Wanjiku",
  admission_number: "1234/2024",
  stream_id: "st",
  average_score: null,
  rank_in_stream: null,
  status: "needs_comment",
  report_card_id: "rc",
  ...over,
});

describe("cardStatusOf", () => {
  it("maps each comment_source to one state, and a missing card to not_generated", () => {
    expect(cardStatusOf(null)).toBe("not_generated");
    expect(cardStatusOf(undefined)).toBe("not_generated");
    expect(cardStatusOf({ comment_source: "none" })).toBe("needs_comment");
    expect(cardStatusOf({ comment_source: "ai" })).toBe("ai_draft");
    expect(cardStatusOf({ comment_source: "teacher_approved" })).toBe("approved");
    expect(cardStatusOf({ comment_source: "teacher_written" })).toBe("approved");
  });
});

describe("summariseClassStatus", () => {
  it("counts generated, pending and approved against the active student total", () => {
    const s = summariseClassStatus(10, [
      { comment_source: "teacher_approved" },
      { comment_source: "teacher_written" },
      { comment_source: "ai" },
      { comment_source: "none" },
    ]);
    expect(s).toEqual({ total: 10, generated: 4, pending: 6, approved: 2, aiDraft: 1, needsComment: 1 });
  });

  it("never reports negative pending", () => {
    expect(summariseClassStatus(1, [{ comment_source: "none" }, { comment_source: "none" }]).pending).toBe(0);
  });

  it("handles an empty class", () => {
    expect(summariseClassStatus(0, [])).toEqual({ total: 0, generated: 0, pending: 0, approved: 0, aiDraft: 0, needsComment: 0 });
  });

  it("approved + aiDraft + needsComment always equals generated", () => {
    const s = summariseClassStatus(9, [{ comment_source: "ai" }, { comment_source: "none" }, { comment_source: "teacher_approved" }, { comment_source: null }]);
    expect(s.approved + s.aiDraft + s.needsComment).toBe(s.generated);
  });
});

describe("classHealthOf", () => {
  it("labels each stage", () => {
    expect(classHealthOf(summariseClassStatus(0, []))).toBe("empty");
    expect(classHealthOf(summariseClassStatus(5, []))).toBe("not_started");
    expect(classHealthOf(summariseClassStatus(5, [{ comment_source: "none" }]))).toBe("needs_generation");
    expect(classHealthOf(summariseClassStatus(2, [{ comment_source: "none" }, { comment_source: "teacher_approved" }]))).toBe("in_review");
    expect(classHealthOf(summariseClassStatus(2, [{ comment_source: "teacher_written" }, { comment_source: "teacher_approved" }]))).toBe("complete");
  });
});

describe("addSummaries", () => {
  it("totals across classes", () => {
    const a = summariseClassStatus(3, [{ comment_source: "teacher_approved" }]);
    const b = summariseClassStatus(2, [{ comment_source: "ai" }, { comment_source: "none" }]);
    expect(addSummaries([a, b])).toEqual({ total: 5, generated: 3, pending: 2, approved: 1, aiDraft: 1, needsComment: 1 });
  });
});

describe("search", () => {
  it("matches name words in any order, case-insensitively", () => {
    const s = student({});
    expect(studentMatchesQuery(s, "jane")).toBe(true);
    expect(studentMatchesQuery(s, "WANJ jane")).toBe(true);
    expect(studentMatchesQuery(s, "wanjiku jane")).toBe(true);
    expect(studentMatchesQuery(s, "peter")).toBe(false);
  });

  it("matches admission numbers, including the slash", () => {
    const s = student({});
    expect(studentMatchesQuery(s, "1234/2024")).toBe(true);
    expect(studentMatchesQuery(s, "234")).toBe(true);
    expect(studentMatchesQuery(s, "9999")).toBe(false);
  });

  it("treats a blank query as match-all and tolerates a missing admission number", () => {
    expect(studentMatchesQuery(student({ admission_number: null }), "   ")).toBe(true);
    expect(studentMatchesQuery(student({ admission_number: null }), "jane")).toBe(true);
  });

  it("filterStreamGroups keeps only streams with matches", () => {
    const groups: StreamGroup[] = [
      { id: "a", name: "7A", students: [student({ student_id: "1", full_name: "Jane Wanjiku" }), student({ student_id: "2", full_name: "John Otieno", admission_number: "55" })] },
      { id: "b", name: "7B", students: [student({ student_id: "3", full_name: "Mary Achieng", admission_number: "77" })] },
    ];
    expect(filterStreamGroups(groups, "")).toBe(groups);
    const out = filterStreamGroups(groups, "otieno");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
    expect(out[0].students.map((s) => s.student_id)).toEqual(["2"]);
    expect(filterStreamGroups(groups, "zzz")).toEqual([]);
  });
});

describe("summariseStream", () => {
  it("splits approved, needs-attention and not-generated", () => {
    expect(
      summariseStream([
        student({ status: "approved" }),
        student({ status: "ai_draft" }),
        student({ status: "needs_comment" }),
        student({ status: "not_generated" }),
      ]),
    ).toEqual({ total: 4, approved: 1, needsAttention: 2, notGenerated: 1 });
  });
});
