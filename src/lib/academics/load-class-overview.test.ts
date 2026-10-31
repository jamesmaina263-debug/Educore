import { describe, expect, it } from "vitest";
import { loadClassOverview, sortExamClasses } from "./load-class-overview";

// Minimal chainable stand-in for the Supabase query builder: every filter returns the builder, and
// awaiting it resolves to the canned result registered for that table (+ whether it was a head count).
type Result = { data?: unknown; count?: number | null; error?: { message: string } | null };

function fakeClient(results: { streams: Result; students: Result; report_cards: Result | ((filters: Record<string, unknown>) => Result) }) {
  const calls: { table: string; filters: Record<string, unknown> }[] = [];
  const client = {
    from(table: "streams" | "students" | "report_cards") {
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (k: string, v: unknown) => ((filters[k] = v), builder),
        in: (k: string, v: unknown) => ((filters[k] = v), builder),
        then: (resolve: (r: Result) => unknown) => {
          calls.push({ table, filters: { ...filters } });
          const r = results[table];
          return Promise.resolve(typeof r === "function" ? r(filters) : r).then(resolve);
        },
      };
      return builder;
    },
  };
  return { client: client as never, calls };
}

const classes = [
  { id: "c7", name: "Grade 7", levelOrder: 7 },
  { id: "c8", name: "Grade 8", levelOrder: 8 },
];

describe("loadClassOverview", () => {
  it("returns live counts per class using the class's streams", async () => {
    const { client, calls } = fakeClient({
      streams: { data: [{ id: "s7a", class_id: "c7" }, { id: "s7b", class_id: "c7" }, { id: "s8a", class_id: "c8" }] },
      students: { count: 4, data: null },
      report_cards: (f) =>
        f.class_id === "c7"
          ? { data: [{ comment_source: "teacher_approved" }, { comment_source: "ai" }, { comment_source: "none" }] }
          : { data: [] },
    });
    const rows = await loadClassOverview(client, "exam1", classes);
    expect(rows.map((r) => r.className)).toEqual(["Grade 7", "Grade 8"]);
    expect(rows[0].streamCount).toBe(2);
    expect(rows[0].summary).toEqual({ total: 4, generated: 3, pending: 1, approved: 1, aiDraft: 1, needsComment: 1 });
    expect(rows[1].summary.generated).toBe(0);
    expect(rows.every((r) => !r.loadFailed)).toBe(true);

    // Cards are only counted for ACTIVE students currently in this class's streams.
    const cardCall = calls.find((c) => c.table === "report_cards" && c.filters.class_id === "c7");
    expect(cardCall?.filters["students.status"]).toBe("active");
    expect(cardCall?.filters["students.current_class_id"]).toEqual(["s7a", "s7b"]);
    expect(cardCall?.filters.exam_id).toBe("exam1");
  });

  it("flags a class whose query failed instead of showing a misleading zero", async () => {
    const { client } = fakeClient({
      streams: { data: [{ id: "s7a", class_id: "c7" }] },
      students: { count: 3, data: null },
      report_cards: { data: null, error: { message: "boom" } },
    });
    const [row] = await loadClassOverview(client, "exam1", [classes[0]]);
    expect(row.loadFailed).toBe(true);
  });

  it("treats a class with no streams as empty, not failed", async () => {
    const { client } = fakeClient({ streams: { data: [] }, students: { count: 0 }, report_cards: { data: [] } });
    const [row] = await loadClassOverview(client, "exam1", [classes[0]]);
    expect(row.loadFailed).toBe(false);
    expect(row.summary.total).toBe(0);
  });

  it("returns nothing for an exam with no classes", async () => {
    const { client } = fakeClient({ streams: { data: [] }, students: {}, report_cards: {} });
    expect(await loadClassOverview(client, "exam1", [])).toEqual([]);
  });
});

describe("sortExamClasses", () => {
  it("orders by level then natural name order", () => {
    const sorted = sortExamClasses([
      { name: "Form 10", levelOrder: 0 },
      { name: "Form 2", levelOrder: 0 },
      { name: "Grade 1", levelOrder: -1 },
    ]);
    expect(sorted.map((c) => c.name)).toEqual(["Grade 1", "Form 2", "Form 10"]);
  });
});
