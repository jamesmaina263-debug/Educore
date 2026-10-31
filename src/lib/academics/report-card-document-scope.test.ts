import { describe, expect, it } from "vitest";
import { loadReportCardDocuments } from "./report-card-document";

// Recording stand-in for the Supabase client: every call to .from(table) is logged with the filters
// applied, and awaiting it resolves to whatever the test registered for that table.
type Call = { table: string; filters: Record<string, unknown> };
function recorder(handlers: Record<string, (filters: Record<string, unknown>) => unknown>) {
  const calls: Call[] = [];
  const client = {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const result = () => {
        calls.push({ table, filters: { ...filters } });
        const h = handlers[table];
        return { data: h ? h(filters) : null, error: null };
      };
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (k: string, v: unknown) => ((filters[k] = v), b),
        in: (k: string, v: unknown) => ((filters[k] = v), b),
        maybeSingle: () => Promise.resolve(result()),
        then: (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return b;
    },
  };
  return { client: client as unknown as Parameters<typeof loadReportCardDocuments>[0], calls };
}

const student = (id: string, last: string) => ({
  id,
  school_id: "sc",
  first_name: "A",
  last_name: last,
  other_names: null,
  admission_number: id,
  streams: { name: "East", classes: { name: "Grade 7" } },
});

describe("loadReportCardDocuments: stream scope", () => {
  it("prints only active students currently in the stream", async () => {
    const { client, calls } = recorder({
      students: (f) => (f.current_class_id ? [{ id: "s1" }, { id: "s2" }] : [student("s1", "Abel"), student("s2", "Zulu")]),
      report_cards: () => [
        { id: "rc1", student_id: "s1", class_id: "c1", comment: "Good", comment_source: "teacher_approved" },
        { id: "rc2", student_id: "s2", class_id: "c1", comment: null, comment_source: "none" },
      ],
      exams: () => ({ id: "e1", name: "Mid-term", terms: { name: "Term 2" } }),
      schools: () => ({ name: "Gititu" }),
      marks: () => [],
      class_rankings: () => [],
      competency_marks: () => [],
    });
    const docs = await loadReportCardDocuments(client, "e1", { streamId: "stream-east" });

    const roster = calls.find((c) => c.table === "students" && "current_class_id" in c.filters);
    expect(roster?.filters).toMatchObject({ current_class_id: "stream-east", status: "active" });
    expect(docs.map((d) => d.student.id)).toEqual(["s1", "s2"]);
    expect(docs.find((d) => d.student.id === "s1")?.released).toBe(true);
    // Cards are looked up by the roster, not by class.
    const cardCall = calls.find((c) => c.table === "report_cards");
    expect(cardCall?.filters.student_id).toEqual(["s1", "s2"]);
    expect(cardCall?.filters.class_id).toBeUndefined();
  });

  it("returns nothing for a stream with no active students", async () => {
    const { client } = recorder({ students: () => [] });
    expect(await loadReportCardDocuments(client, "e1", { streamId: "empty" })).toEqual([]);
  });
});

describe("loadReportCardDocuments: large classes are queried in chunks", () => {
  it("never sends more than 40 students to the marks query, and keeps every mark", async () => {
    const n = 100;
    const ids = Array.from({ length: n }, (_, i) => `s${String(i).padStart(3, "0")}`);
    const { client, calls } = recorder({
      report_cards: () => ids.map((id, i) => ({ id: `rc${i}`, student_id: id, class_id: "c1", comment: null, comment_source: "none" })),
      exams: () => ({ id: "e1", name: "Mid-term", terms: { name: "Term 2" } }),
      students: (f) => (f.id as string[]).map((id) => student(id, `L${id}`)),
      marks: (f) => (f.student_id as string[]).flatMap((id) => [{ student_id: id, raw_score: 50, subjects: { name: "Maths" }, grading_scale_bands: null }]),
      schools: () => ({ name: "Gititu" }),
      class_rankings: () => [],
      competency_marks: () => [],
    });
    const docs = await loadReportCardDocuments(client, "e1", { classId: "c1" });

    const markCalls = calls.filter((c) => c.table === "marks");
    expect(markCalls.length).toBe(3); // 100 students / 40
    expect(Math.max(...markCalls.map((c) => (c.filters.student_id as string[]).length))).toBeLessThanOrEqual(40);
    expect(docs).toHaveLength(n);
    expect(docs.every((d) => d.subjects.length === 1)).toBe(true);
    const compCalls = calls.filter((c) => c.table === "competency_marks");
    expect(Math.max(...compCalls.map((c) => (c.filters.student_id as string[]).length))).toBeLessThanOrEqual(8);
  });
});
