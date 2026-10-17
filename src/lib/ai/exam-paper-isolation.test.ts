import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mergeCurriculumStrands } from "./kicd-grounding";
import { buildCurriculumContext } from "./scheme-of-work";

// Regression guard: the exam paper generator must reuse the existing curriculum
// functionality read-only and must not disturb it. These checks read the
// generator's own source (comments stripped) and assert it never imports the
// existing merge/grounding helpers, never writes curriculum/KICD tables, and
// that its migration is additive. A second block pins the existing behaviour
// the generator deliberately does NOT change.

const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const generatorFiles = [
  "src/lib/ai/exam-paper.ts",
  "src/lib/ai/exam-paper-sources.ts",
  "src/app/(app)/exams/papers/actions.ts",
  "src/app/(app)/exams/papers/_data.ts",
  "src/components/exams/exam-papers-section.tsx",
];

describe("exam paper generator is read-only against curriculum", () => {
  it.each(generatorFiles)("%s never uses the source-merging grounding helpers", (file) => {
    const code = stripComments(read(file));
    expect(code).not.toMatch(/mergeCurriculumStrands/);
    expect(code).not.toMatch(/fetchSharedKicdStrands/);
    expect(code).not.toMatch(/buildCurriculumContext/);
    expect(code).not.toMatch(/from\s+["']@\/lib\/ai\/(kicd-grounding|scheme-of-work)["']/);
  });

  it.each(generatorFiles)("%s never writes to curriculum or KICD tables or their storage", (file) => {
    const code = stripComments(read(file));
    expect(code).not.toMatch(/from\(\s*["'](curriculum_|kicd_)[a-z_]*["']\s*\)\s*\.\s*(insert|update|upsert|delete)/);
    expect(code).not.toMatch(/curriculum-documents/);
    expect(code).not.toMatch(/curriculum_extraction_batches/);
  });

  it("introduces no second upload or ingestion path", () => {
    for (const file of generatorFiles) {
      const code = stripComments(read(file));
      expect(code).not.toMatch(/storage\s*\.\s*from\(/);
      expect(code).not.toMatch(/extractPdfText|uploadCurriculumDocument|importKicdDocument/);
    }
  });

  it("its migration is additive: new tables and one permission only", () => {
    const sql = stripComments(read("supabase/migrations/20261017190000_exam_paper_generator.sql").replace(/^--.*$/gm, ""));
    expect(sql).not.toMatch(/alter\s+table\s+(curriculum_|kicd_|exams|exam_subjects|exam_classes|marks|classes|subjects|competency_)/i);
    expect(sql).not.toMatch(/\bdrop\s+(table|policy|column|function)/i);
    expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?policy\s+\S+\s+on\s+(curriculum_|kicd_)/i);
    const created = [...sql.matchAll(/create\s+table\s+(\w+)/gi)].map((m) => m[1]);
    expect(created.sort()).toEqual(["exam_paper_ai_requests", "exam_paper_questions", "exam_papers"]);
  });
});

describe("existing curriculum behaviour the generator must not change", () => {
  const sub = (name: string, over: Record<string, unknown> = {}) => ({
    name,
    learning_outcomes: "outcome",
    key_inquiry_questions: null,
    rubric_text: null,
    content_source: "school_authored",
    ...over,
  });

  it("buildCurriculumContext still excludes drafts and empty rows", () => {
    const ctx = buildCurriculumContext([
      { name: "S", sub_strands: [sub("Kept"), sub("Draft", { content_source: "draft" }), sub("Empty", { learning_outcomes: null })] },
    ]);
    expect(ctx?.itemCount).toBe(1);
    expect(ctx?.text).toContain("Kept");
    expect(ctx?.text).not.toContain("Draft");
  });

  it("mergeCurriculumStrands (Scheme of Work grounding) still lets the school's own content win on conflict", () => {
    const merged = mergeCurriculumStrands(
      [{ name: "Strand", sub_strands: [sub("Same", { learning_outcomes: "school version" })] }],
      [{ name: "Strand", sub_strands: [sub("Same", { learning_outcomes: "kicd version", content_source: "kicd_licensed" })] }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].sub_strands[0].learning_outcomes).toBe("school version");
  });

  it("the existing Scheme of Work action still grounds through the merge (unchanged)", () => {
    const code = stripComments(read("src/app/(app)/academics/scheme-of-work/actions.ts"));
    expect(code).toMatch(/mergeCurriculumStrands/);
    expect(code).toMatch(/fetchSharedKicdStrands/);
  });
});
