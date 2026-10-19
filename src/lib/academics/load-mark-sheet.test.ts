import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadMarkSheetModel } from "./load-mark-sheet";

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
  return { client: client as unknown as Parameters<typeof loadMarkSheetModel>[0], calls };
}

const data = {
  exams: { name: "CAT 1", exam_type: "cat", status: "closed", terms: { name: "Term 2", academic_years: { name: "2026" } } },
  classes: { name: "Grade 6", school_id: "sc" },
  exam_subjects: [
    { max_score: 100, subjects: { id: "m", name: "Mathematics" } },
    { max_score: 50, subjects: { id: "e", name: "English" } },
  ],
  streams: [{ id: "st-a", name: "A" }],
  students: [{ id: "1", first_name: "Ann", last_name: "Abel", other_names: null, admission_number: "A1", current_class_id: "st-a" }],
  marks: [
    { student_id: "1", subject_id: "m", raw_score: 0, grading_scale_bands: { label: "E — Poor", level_order: 1 } },
    { student_id: "1", subject_id: "e", raw_score: "40.5", grading_scale_bands: null },
  ],
  class_rankings: [{ student_id: "1", total_score: 40.5, average_score: "20.25", rank_in_stream: 1, rank_in_class: 1 }],
  schools: { name: "Gititu High", motto: "Motto", logo_url: "https://x/l.png", address: "Box 1", phone: "07", email: "a@b.c", primary_color: "#112233" },
};

describe("loadMarkSheetModel", () => {
  it("assembles school branding, term/year, subjects with their own max scores, and learners", async () => {
    const { client } = fakeSupabase(data);
    const model = await loadMarkSheetModel(client, { examId: "e1", classId: "c1", preparedBy: "Ms W" });
    expect(model).toMatchObject({
      school: { name: "Gititu High", logoUrl: "https://x/l.png", primaryColor: "#112233", motto: "Motto" },
      exam: { name: "CAT 1", status: "closed", termName: "Term 2", academicYearName: "2026" },
      classLabel: "Grade 6",
      preparedBy: "Ms W",
      kind: "numeric",
    });
    expect(model!.subjects).toEqual([
      { id: "e", name: "English", maxScore: 50 },
      { id: "m", name: "Mathematics", maxScore: 100 },
    ]);
    expect(model!.learners[0]).toMatchObject({ admissionNumber: "A1", name: "Ann Abel", streamName: "A", total: 40.5, average: 20.25, rankInStream: 1 });
  });

  it("keeps a genuine zero (numeric column returned as 0) distinct from a missing mark", async () => {
    const { client } = fakeSupabase(data);
    const model = await loadMarkSheetModel(client, { examId: "e1", classId: "c1", preparedBy: null });
    expect(model!.learners[0].cells.m).toMatchObject({ score: 0, missing: false });
  });

  it("applies enrolment: a learner not enrolled in a selective subject shows n/a, not missing", async () => {
    const withElective = {
      ...data,
      exams: { ...data.exams, terms: { name: "Term 2", academic_year_id: "y1", academic_years: { name: "2026" } } },
      students: [
        { id: "1", first_name: "Ann", last_name: "Abel", other_names: null, admission_number: "A1", current_class_id: "st-a" },
        { id: "2", first_name: "Ben", last_name: "Bett", other_names: null, admission_number: "A2", current_class_id: "st-a" },
      ],
      // English is selective and only Ann takes it.
      student_subjects: [
        { student_id: "1", subject_id: "e", is_active: true },
        { student_id: "2", subject_id: "e", is_active: false },
      ],
    };
    const model = await loadMarkSheetModel(fakeSupabase(withElective).client, { examId: "e1", classId: "c1", preparedBy: null });
    const [ann, ben] = model!.learners;
    expect(ann.cells.e).toMatchObject({ score: 40.5, missing: false });
    expect(ben.cells.e).toMatchObject({ text: "n/a", notApplicable: true });
    expect(ben).toMatchObject({ expected: 1, incomplete: true }); // still missing Mathematics, which he does take
  });

  it("without an academic year, or without student_subjects rows, nothing about the sheet changes", async () => {
    const { client, calls } = fakeSupabase(data); // no academic_year_id, no student_subjects
    const model = await loadMarkSheetModel(client, { examId: "e1", classId: "c1", preparedBy: null });
    expect(model!.learners[0].cells.m.notApplicable).toBeUndefined();
    expect(calls.some((c) => c.startsWith("student_subjects"))).toBe(false); // no year => no extra query at all
  });

  it("returns null when the exam or class isn't visible to the caller (RLS)", async () => {
    expect(await loadMarkSheetModel(fakeSupabase({ ...data, exams: null }).client, { examId: "e", classId: "c", preparedBy: null })).toBeNull();
    expect(await loadMarkSheetModel(fakeSupabase({ ...data, classes: null }).client, { examId: "e", classId: "c", preparedBy: null })).toBeNull();
  });

  it("performs reads only, through the caller's session", async () => {
    const { client, calls } = fakeSupabase(data);
    await loadMarkSheetModel(client, { examId: "e1", classId: "c1", preparedBy: null });
    expect(calls.filter((c) => /\.(insert|update|upsert|delete|rpc)$/.test(c))).toEqual([]);
  });
});

describe("the shared export menu is unchanged for every other page", () => {
  const root = path.resolve(__dirname, "../../..");
  const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
  it.each(["src/components/finance/invoices-section.tsx", "src/components/payroll/payroll-section.tsx", "src/components/boarding/reports-section.tsx", "src/components/health/reports-section.tsx"])(
    "%s still uses the standard table PDF",
    (file) => {
      expect(read(file)).not.toContain("onExportPdf");
    },
  );
  it("keeps the standard PDF as the default and the override optional", () => {
    const src = read("src/components/shared/table-export-menu.tsx");
    expect(src).toContain("onExportPdf?:");
    expect(src).toContain("exportPDF(rows, filenameStub, title, subtitle, logoUrl, signOff)");
  });
});
