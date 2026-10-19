import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isReleased, releasedComment, loadReportCardDocuments } from "./report-card-document";

function fakeSupabase(results: Record<string, unknown>) {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      const proxy: unknown = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: results[table] ?? null, error: null });
            return () => {
              calls.push(`${table}.${String(prop)}`);
              return proxy;
            };
          },
        },
      );
      return proxy;
    },
  };
  return { client: client as unknown as Parameters<typeof loadReportCardDocuments>[0], calls, raw: client as unknown as SupabaseClient };
}

describe("release rules", () => {
  it("only teacher-approved or teacher-written comments count as released", () => {
    expect(isReleased("teacher_approved")).toBe(true);
    expect(isReleased("teacher_written")).toBe(true);
    expect(isReleased("ai")).toBe(false);
    expect(isReleased("none")).toBe(false);
    expect(isReleased(null)).toBe(false);
  });
  it("never returns an AI draft or empty comment for printing", () => {
    expect(releasedComment("ai", "AI wrote this")).toBeNull();
    expect(releasedComment("none", "stray text")).toBeNull();
    expect(releasedComment("teacher_approved", "  Well done  ")).toBe("Well done");
    expect(releasedComment("teacher_written", "   ")).toBeNull();
  });
});

const base = {
  exams: { id: "e1", name: "Mid-term", terms: { name: "Term 2" } },
  schools: { name: "Gititu High", logo_url: "https://x/logo.png", primary_color: "#123456", address: "Box 1", phone: "0700" },
  students: [
    { id: "s2", school_id: "sc", first_name: "Zed", last_name: "Zulu", other_names: null, admission_number: "2", streams: { name: "A", classes: { name: "Grade 6" } } },
    { id: "s1", school_id: "sc", first_name: "Amy", last_name: "Abel", other_names: "K", admission_number: "1", streams: { name: "A", classes: { name: "Grade 6" } } },
  ],
  marks: [
    { student_id: "s1", raw_score: null, subjects: { name: "Mathematics" }, grading_scale_bands: { label: "A — Exceeding Expectation" } },
    { student_id: "s1", raw_score: 0, subjects: { name: "English" }, grading_scale_bands: null },
  ],
  class_rankings: [{ student_id: "s1", average_score: 70, rank_in_stream: 2 }],
  competency_marks: [],
};

describe("loadReportCardDocuments", () => {
  it("returns nothing when no report card is visible (unreleased/foreign for a parent, or not generated)", async () => {
    const { client } = fakeSupabase({ ...base, report_cards: [] });
    expect(await loadReportCardDocuments(client, "e1", { studentId: "s1" })).toEqual([]);
  });

  it("builds one document per student, sorted by surname, with school branding", async () => {
    const { client } = fakeSupabase({
      ...base,
      report_cards: [
        { student_id: "s2", comment: "x", comment_source: "none" },
        { student_id: "s1", comment: "Good work", comment_source: "teacher_approved" },
      ],
    });
    const docs = await loadReportCardDocuments(client, "e1", { classId: "c1" });
    expect(docs.map((d) => d.student.fullName)).toEqual(["Amy K Abel", "Zed Zulu"]);
    expect(docs[0].school).toMatchObject({ name: "Gititu High", logoUrl: "https://x/logo.png", primaryColor: "#123456" });
    expect(docs[0].exam).toEqual({ id: "e1", name: "Mid-term", termName: "Term 2" });
    expect(docs[0].student.classLabel).toBe("Grade 6 A");
  });

  it("keeps band grades for CBC exams and a real zero score", async () => {
    const { client } = fakeSupabase({ ...base, report_cards: [{ student_id: "s1", comment: "ok", comment_source: "teacher_written" }] });
    const [doc] = await loadReportCardDocuments(client, "e1", { studentId: "s1" });
    expect(doc.subjects).toEqual([
      { subject: "English", score: 0, grade: null },
      { subject: "Mathematics", score: null, grade: "A — Exceeding Expectation" },
    ]);
    expect(doc.average).toBe(70);
    expect(doc.rank).toBe(2);
  });

  it("flags unreleased cards and withholds AI comment text", async () => {
    const { client } = fakeSupabase({ ...base, report_cards: [{ student_id: "s1", comment: "AI draft text", comment_source: "ai" }] });
    const [doc] = await loadReportCardDocuments(client, "e1", { studentId: "s1" });
    expect(doc.released).toBe(false);
    expect(doc.comment).toBeNull();
  });

  it("builds the assessment details block (worded like the mark sheet header)", async () => {
    const { client } = fakeSupabase({
      ...base,
      exams: { id: "e1", name: "End-Term", exam_type: "exam", terms: { name: "Term 3", academic_years: { name: "2027" } } },
      report_cards: [{ student_id: "s1", class_id: "c1", comment: "ok", comment_source: "teacher_approved" }],
    });
    const [doc] = await loadReportCardDocuments(client, "e1", { studentId: "s1" });
    expect(doc.details).toMatchObject({ assessment: "End-Term (Exam)", termYear: "Term 3, 2027", grading: "Mixed marks and competency", classSize: null });
    expect(Number.isNaN(Date.parse(doc.details.generatedAt))).toBe(false);
  });

  it("reads the class size only when asked (staff print), counting active learners across the class's streams", async () => {
    const results = {
      ...base,
      students: base.students.map((st) => ({ ...st, current_class_id: "st1" })),
      streams: [{ id: "st1", class_id: "c1" }],
      report_cards: [{ student_id: "s1", class_id: "c1", comment: "ok", comment_source: "teacher_approved" }],
    };
    const [without] = await loadReportCardDocuments(fakeSupabase(results).client, "e1", { studentId: "s1" });
    expect(without.details.classSize).toBeNull();
    const [withSize] = await loadReportCardDocuments(fakeSupabase(results).client, "e1", { studentId: "s1" }, { includeClassSize: true });
    expect(withSize.details.classSize).toBe(2);
  });

  it("performs reads only", async () => {
    const { client, calls } = fakeSupabase({ ...base, report_cards: [{ student_id: "s1", comment: "c", comment_source: "teacher_approved" }] });
    await loadReportCardDocuments(client, "e1", { all: true });
    expect(calls.filter((c) => /\.(insert|update|upsert|delete|rpc)$/.test(c))).toEqual([]);
  });

  it("takes the display options from the school's report settings (defaults when none are stored)", async () => {
    const cards = [{ student_id: "s1", comment: "ok", comment_source: "teacher_approved" }];
    const plain = fakeSupabase({ ...base, report_cards: cards });
    expect((await loadReportCardDocuments(plain.client, "e1", { studentId: "s1" }))[0].options).toEqual({ showRank: true, showCompetencies: true, showSignatures: true });
    const custom = fakeSupabase({ ...base, schools: { ...base.schools, report_settings: { ranking_enabled: false, show_signatures: false } }, report_cards: cards });
    expect((await loadReportCardDocuments(custom.client, "e1", { studentId: "s1" }))[0].options).toEqual({ showRank: false, showCompetencies: true, showSignatures: false });
  });
});

