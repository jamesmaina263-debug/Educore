import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeCurriculumStrands, fetchSharedKicdStrands } from "./kicd-grounding";
import { buildCurriculumContext } from "./scheme-of-work";

const sub = (name: string, lo: string | null, src = "school_authored") => ({ name, learning_outcomes: lo, key_inquiry_questions: null, rubric_text: null, content_source: src });

describe("mergeCurriculumStrands", () => {
  const kicd = [{ name: "Numbers", sub_strands: [sub("Whole", "KICD whole", "kicd_licensed"), sub("Fractions", "KICD fractions", "kicd_licensed")] }];

  it("returns KICD content unchanged when the school has none", () => {
    expect(mergeCurriculumStrands([], kicd)).toEqual(kicd);
  });
  it("returns the school's usable content when there is no KICD content", () => {
    const school = [{ name: "Local", sub_strands: [sub("A", "x")] }];
    expect(mergeCurriculumStrands(school, [])).toEqual(school);
  });
  it("lets the school's row win on a name conflict, case-insensitively, and keeps the rest", () => {
    const school = [{ name: " numbers ", sub_strands: [sub("WHOLE", "School whole")] }];
    const merged = mergeCurriculumStrands(school, kicd);
    expect(merged).toHaveLength(1);
    expect(merged[0].sub_strands.map((s) => s.learning_outcomes)).toEqual(["School whole", "KICD fractions"]);
  });
  it("never lets a school DRAFT or empty row override KICD content", () => {
    const school = [{ name: "Numbers", sub_strands: [sub("Whole", "unreviewed", "draft"), sub("Fractions", "  ")] }];
    expect(mergeCurriculumStrands(school, kicd)).toEqual(kicd);
  });
  it("appends school-only strands after KICD ones", () => {
    const school = [{ name: "Local", sub_strands: [sub("A", "x")] }];
    expect(mergeCurriculumStrands(school, kicd).map((s) => s.name)).toEqual(["Numbers", "Local"]);
  });
  it("feeds buildCurriculumContext so KICD-only content grounds generation", () => {
    const ctx = buildCurriculumContext(mergeCurriculumStrands([], kicd));
    expect(ctx?.itemCount).toBe(2);
    expect(ctx?.text).toContain("KICD whole");
  });
});

// Table-keyed fake: each table resolves to a fixed result whatever is
// chained; every chained op is also recorded (table, op, args) so a test can
// assert not just the outcome but that specific filters were actually built.
function fake(tables: Record<string, unknown>) {
  const calls: { table: string; op: string; args: unknown[] }[] = [];
  const from = vi.fn((t: string) => {
    // An array is a queue of results, one per from(t) call, for tests that
    // query the same table twice (platform-wide, then the school's own).
    const raw = tables[t];
    const result = (Array.isArray(raw) ? raw.shift() : raw) ?? { data: null, error: null };
    const chain: Record<string, unknown> = {};
    for (const op of ["select", "eq", "in", "order", "is"]) {
      chain[op] = (...args: unknown[]) => (calls.push({ table: t, op, args }), chain);
    }
    chain.maybeSingle = () => Promise.resolve(result);
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, from, calls };
}

const strandRows = { data: [{ name: "Numbers", level_order: 0, kicd_sub_strands: [{ name: "Whole", learning_outcomes: "L", key_inquiry_questions: null, rubric_text: null }] }], error: null };

describe("fetchSharedKicdStrands", () => {
  const ids = { classId: "c1", subjectId: "s1" };
  const ok = {
    classes: { data: { kicd_grade: "G6" } },
    subjects: { data: { catalogue_id: "cat1" } },
    kicd_learning_areas: { data: [{ id: "la1" }] },
    kicd_strands: strandRows,
  };

  it("returns mapped strands tagged kicd_licensed when every link resolves", async () => {
    const out = await fetchSharedKicdStrands(fake(ok).client, ids);
    expect(out).toEqual([{ name: "Numbers", sub_strands: [{ name: "Whole", learning_outcomes: "L", key_inquiry_questions: null, rubric_text: null, content_source: "kicd_licensed" }] }]);
  });
  it("fails closed when the class has no KICD grade, without querying further", async () => {
    const f = fake({ ...ok, classes: { data: { kicd_grade: null } } });
    expect(await fetchSharedKicdStrands(f.client, ids)).toEqual([]);
    expect(f.from).not.toHaveBeenCalledWith("kicd_strands");
  });
  it("fails closed for an unrecognised grade value", async () => {
    expect(await fetchSharedKicdStrands(fake({ ...ok, classes: { data: { kicd_grade: "Grade 6" } } }).client, ids)).toEqual([]);
  });
  it("fails closed when the subject has no catalogue entry or no learning area is mapped to it", async () => {
    expect(await fetchSharedKicdStrands(fake({ ...ok, subjects: { data: { catalogue_id: null } } }).client, ids)).toEqual([]);
    const f = fake({ ...ok, kicd_learning_areas: { data: [] } });
    expect(await fetchSharedKicdStrands(f.client, ids)).toEqual([]);
    expect(f.from).not.toHaveBeenCalledWith("kicd_strands");
  });
  it("builds the query with BOTH is_enabled and school_id-is-null filters (the only gate against a school's private KICD content leaking into another school's grounding)", async () => {
    const f = fake(ok);
    await fetchSharedKicdStrands(f.client, ids);
    const kicdStrandCalls = f.calls.filter((c) => c.table === "kicd_strands");
    expect(kicdStrandCalls).toContainEqual({ table: "kicd_strands", op: "eq", args: ["kicd_content_sources.is_enabled", true] });
    expect(kicdStrandCalls).toContainEqual({ table: "kicd_strands", op: "is", args: ["kicd_content_sources.school_id", null] });
  });
  it("returns [] without querying when ids are missing", async () => {
    const f = fake(ok);
    expect(await fetchSharedKicdStrands(f.client, { classId: null, subjectId: "s1" })).toEqual([]);
    expect(f.from).not.toHaveBeenCalled();
  });
  it("never throws: a lookup error yields []", async () => {
    const client = { from: () => { throw new Error("db down"); } } as unknown as SupabaseClient;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await fetchSharedKicdStrands(client, ids)).toEqual([]);
  });

  describe("the school's own published sources", () => {
    const own = (name: string, lo: string) => ({ data: [{ name, level_order: 0, kicd_sub_strands: [{ name: "Whole", learning_outcomes: lo, key_inquiry_questions: null, rubric_text: null }] }], error: null });
    const withSchool = { ...ok, classes: { data: { kicd_grade: "G6", school_id: "sch1" } } };

    it("filters the second query to the class's own school AND published only", async () => {
      const f = fake({ ...withSchool, kicd_strands: [strandRows, own("Numbers", "own")] });
      await fetchSharedKicdStrands(f.client, ids);
      const calls = f.calls.filter((c) => c.table === "kicd_strands");
      expect(calls).toContainEqual({ table: "kicd_strands", op: "eq", args: ["kicd_content_sources.school_id", "sch1"] });
      expect(calls.filter((c) => c.op === "eq" && c.args[0] === "kicd_content_sources.is_enabled")).toHaveLength(2);
    });
    it("lets the school's own KICD content win over platform-wide on a name conflict", async () => {
      const out = await fetchSharedKicdStrands(fake({ ...withSchool, kicd_strands: [strandRows, own("Numbers", "own")] }).client, ids);
      expect(out).toHaveLength(1);
      expect(out[0].sub_strands.map((s) => s.learning_outcomes)).toEqual(["own"]);
    });
    it("keeps platform-wide strands the school hasn't replaced, and adds the school's own", async () => {
      const out = await fetchSharedKicdStrands(fake({ ...withSchool, kicd_strands: [strandRows, own("Local strand", "own")] }).client, ids);
      expect(out.map((s) => s.name)).toEqual(["Numbers", "Local strand"]);
    });
    it("uses the school's own content when there is no platform-wide content", async () => {
      const out = await fetchSharedKicdStrands(fake({ ...withSchool, kicd_strands: [{ data: [], error: null }, own("Numbers", "own")] }).client, ids);
      expect(out.map((s) => s.name)).toEqual(["Numbers"]);
    });
    it("fails closed to platform-wide only when the class has no school id (never queries unscoped)", async () => {
      const f = fake(ok);
      await fetchSharedKicdStrands(f.client, ids);
      expect(f.calls.filter((c) => c.table === "kicd_strands" && c.args[0] === "kicd_content_sources.school_id")).toEqual([
        { table: "kicd_strands", op: "is", args: ["kicd_content_sources.school_id", null] },
      ]);
    });
  });
});
