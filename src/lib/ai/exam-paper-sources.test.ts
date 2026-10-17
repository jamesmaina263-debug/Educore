import { describe, it, expect } from "vitest";
import { loadExamSourceOptions } from "./exam-paper-sources";
import type { SupabaseClient } from "@supabase/supabase-js";

// A chainable fake PostgREST builder that resolves to a per-table result and
// records every method called, so tests can prove the loader performs reads only.
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
  return { client: client as unknown as SupabaseClient, calls };
}

const S = "school-1";
const base = {
  classes: { kicd_grade: "G4", school_id: S },
  subjects: { catalogue_id: "cat-1", school_id: S },
  curriculum_strands: [
    {
      name: "Own strand",
      curriculum_sub_strands: [
        { id: "own-1", name: "Own sub", level_order: 1, learning_outcomes: "o", key_inquiry_questions: null, rubric_text: null, content_source: "school_authored", content_updated_at: null },
        { id: "own-2", name: "Own draft", level_order: 2, learning_outcomes: "o", key_inquiry_questions: null, rubric_text: null, content_source: "draft", content_updated_at: null },
      ],
    },
  ],
  kicd_learning_areas: [{ id: "area-1" }],
};
const kRow = (srcId: string, schoolId: string | null, enabled = true) => ({
  name: `Strand ${srcId}`,
  kicd_content_sources: { id: srcId, name: `Source ${srcId}`, licence_reference: "LIC", attribution: "Attr", is_enabled: enabled, school_id: schoolId },
  kicd_sub_strands: [{ id: `ks-${srcId}`, name: "K sub", level_order: 1, learning_outcomes: "ko", key_inquiry_questions: null, rubric_text: null }],
});

describe("loadExamSourceOptions", () => {
  it("returns platform KICD, this school's KICD and school-authored as SEPARATE options, never merged", async () => {
    const { client } = fakeSupabase({ ...base, kicd_strands: [kRow("p1", null), kRow("s1", S)] });
    const r = await loadExamSourceOptions(client, { classId: "c", subjectId: "s", schoolId: S });
    expect(r?.options.map((o) => o.kind).sort()).toEqual(["platform_kicd", "school_authored", "school_kicd"]);
    const own = r!.options.find((o) => o.kind === "school_authored")!;
    expect(own.subStrands.map((s) => s.ref)).toEqual(["own-1", "own-2"]); // draft is listed (flagged later), not hidden or merged
    const platform = r!.options.find((o) => o.kind === "platform_kicd")!;
    expect(platform.subStrands.map((s) => s.ref)).toEqual(["ks-p1"]);
    expect(platform).toMatchObject({ licenceReference: "LIC", attribution: "Attr", sourceId: "p1" });
  });

  it("never returns another school's private source or a disabled source", async () => {
    const { client } = fakeSupabase({ ...base, kicd_strands: [kRow("other", "school-2"), kRow("off", null, false), kRow("ok", null)] });
    const r = await loadExamSourceOptions(client, { classId: "c", subjectId: "s", schoolId: S });
    expect(r?.options.filter((o) => o.kind !== "school_authored").map((o) => o.sourceId)).toEqual(["ok"]);
  });

  it("fails closed with an explanatory note when the class has no KICD grade", async () => {
    const { client } = fakeSupabase({ ...base, classes: { kicd_grade: null, school_id: S }, kicd_strands: [kRow("p1", null)] });
    const r = await loadExamSourceOptions(client, { classId: "c", subjectId: "s", schoolId: S });
    expect(r?.options.map((o) => o.kind)).toEqual(["school_authored"]);
    expect(r?.notes.join(" ")).toMatch(/no KICD grade set/);
  });

  it("fails closed when the subject has no catalogue link", async () => {
    const { client } = fakeSupabase({ ...base, subjects: { catalogue_id: null, school_id: S }, kicd_strands: [kRow("p1", null)] });
    const r = await loadExamSourceOptions(client, { classId: "c", subjectId: "s", schoolId: S });
    expect(r?.options.map((o) => o.kind)).toEqual(["school_authored"]);
    expect(r?.notes.join(" ")).toMatch(/not linked to a KICD learning area/);
  });

  it("returns null when the class or subject isn't in the caller's school", async () => {
    const { client } = fakeSupabase({ ...base, classes: null });
    expect(await loadExamSourceOptions(client, { classId: "c", subjectId: "s", schoolId: S })).toBeNull();
  });

  it("performs reads only", async () => {
    const { client, calls } = fakeSupabase({ ...base, kicd_strands: [kRow("p1", null)] });
    await loadExamSourceOptions(client, { classId: "c", subjectId: "s", schoolId: S });
    expect(calls.filter((c) => /\.(insert|update|upsert|delete|rpc)$/.test(c))).toEqual([]);
  });
});
