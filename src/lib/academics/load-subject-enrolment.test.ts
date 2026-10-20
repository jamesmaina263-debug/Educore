import { describe, it, expect, vi, afterEach } from "vitest";
import { loadEnrolmentRows } from "./load-subject-enrolment";

type Call = { table: string; select?: string; eq: Record<string, unknown>; in: Record<string, unknown[]>; order?: string; range?: [number, number]; limit?: number };
type Result = { data: unknown; error: { message: string } | null };

function fakeSupabase(handler: (c: Call) => Result | Promise<Result>) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, eq: {}, in: {} };
      const builder: Record<string, unknown> = {
        select(cols: string) {
          call.select = cols;
          return builder;
        },
        eq(col: string, v: unknown) {
          call.eq[col] = v;
          return builder;
        },
        in(col: string, v: unknown[]) {
          call.in[col] = v;
          return builder;
        },
        order(col: string) {
          call.order = col;
          return builder;
        },
        range(a: number, b: number) {
          call.range = [a, b];
          return builder;
        },
        limit(n: number) {
          call.limit = n;
          return builder;
        },
        then(resolve: (v: Result) => void, reject: (e: unknown) => void) {
          calls.push(call);
          return Promise.resolve(handler(call)).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as Parameters<typeof loadEnrolmentRows>[0], calls };
}

const ok = (data: unknown): Result => ({ data, error: null });
const ids = (n: number, prefix = "s") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const pageRow = (i: number) => ({ student_id: `s${i}`, subject_id: "phy", class_id: "c", is_active: true });

afterEach(() => vi.restoreAllMocks());

describe("loadEnrolmentRows", () => {
  it("makes no query at all without an academic year, students or subjects", async () => {
    const { client, calls } = fakeSupabase(() => ok([]));
    expect(await loadEnrolmentRows(client, { academicYearId: null, classIds: ["c"], studentIds: ["a"], subjectIds: ["m"] })).toEqual([]);
    expect(await loadEnrolmentRows(client, { academicYearId: "y", classIds: ["c"], studentIds: [], subjectIds: ["m"] })).toEqual([]);
    expect(await loadEnrolmentRows(client, { academicYearId: "y", classIds: [], studentIds: ["a"], subjectIds: ["m"] })).toEqual([]);
    expect(await loadEnrolmentRows(client, { academicYearId: "y", classIds: ["c"], studentIds: ["a"], subjectIds: [] })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("costs exactly one tiny probe query when the school has no enrolment rows (the common case)", async () => {
    const { client, calls } = fakeSupabase(() => ok([]));
    expect(await loadEnrolmentRows(client, { academicYearId: "y", classIds: ["c"], studentIds: ids(250), subjectIds: ["m"] })).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: "student_subjects", eq: { academic_year_id: "y" }, in: { class_id: ["c"] }, limit: 1 });
  });

  it("reads rows for the year, subjects and students, and maps them", async () => {
    const { client, calls } = fakeSupabase((c) =>
      c.limit === 1 ? ok([{ id: "x" }]) : ok([{ student_id: "a", subject_id: "phy", class_id: "c", is_active: true }, { student_id: "b", subject_id: "phy", class_id: "c", is_active: false }]),
    );
    const rows = await loadEnrolmentRows(client, { academicYearId: "y", classIds: ["c"], studentIds: ["a", "b"], subjectIds: ["phy"] });
    expect(rows).toEqual([
      { studentId: "a", subjectId: "phy", classId: "c", isActive: true },
      { studentId: "b", subjectId: "phy", classId: "c", isActive: false },
    ]);
    const read = calls[1];
    expect(read.eq).toEqual({ academic_year_id: "y" });
    expect(read.in).toEqual({ class_id: ["c"], subject_id: ["phy"], student_id: ["a", "b"] });
    expect(read.order).toBe("id");
  });

  it("splits a large class into chunks of 100 so the request URL stays short", async () => {
    const { client, calls } = fakeSupabase((c) => (c.limit === 1 ? ok([{ id: "x" }]) : ok([])));
    await loadEnrolmentRows(client, { academicYearId: "y", classIds: ["c"], studentIds: ids(250), subjectIds: ["phy"] });
    const reads = calls.filter((c) => c.limit !== 1);
    expect(reads.map((c) => c.in.student_id.length).sort((a, b) => b - a)).toEqual([100, 100, 50]);
  });

  it("pages past the 1000-row response cap instead of silently truncating", async () => {
    const { client, calls } = fakeSupabase((c) => {
      if (c.limit === 1) return ok([{ id: "x" }]);
      return c.range![0] === 0 ? ok(Array.from({ length: 1000 }, (_, i) => pageRow(i))) : ok([pageRow(1000), pageRow(1001)]);
    });
    const rows = await loadEnrolmentRows(client, { academicYearId: "y", classIds: ["c"], studentIds: ["a"], subjectIds: ["phy"] });
    expect(rows).toHaveLength(1002);
    expect(calls.filter((c) => c.limit !== 1).map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("falls back to [] (everyone takes everything) when the probe fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeSupabase(() => ({ data: null, error: { message: "boom" } }));
    expect(await loadEnrolmentRows(client, { academicYearId: "y", classIds: ["c"], studentIds: ["a"], subjectIds: ["m"] })).toEqual([]);
  });

  it("is all-or-nothing: if any chunk fails no partial list is returned", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeSupabase((c) => {
      if (c.limit === 1) return ok([{ id: "x" }]);
      return c.in.student_id.includes("s150") ? { data: null, error: { message: "chunk failed" } } : ok([pageRow(1)]);
    });
    expect(await loadEnrolmentRows(client, { academicYearId: "y", classIds: ["c"], studentIds: ids(250), subjectIds: ["phy"] })).toEqual([]);
  });

  it("falls back to [] when a query throws instead of resolving", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeSupabase(() => {
      throw new Error("network down");
    });
    expect(await loadEnrolmentRows(client, { academicYearId: "y", classIds: ["c"], studentIds: ["a"], subjectIds: ["m"] })).toEqual([]);
  });

  it("never writes: only select queries are issued", async () => {
    const { client, calls } = fakeSupabase((c) => (c.limit === 1 ? ok([{ id: "x" }]) : ok([])));
    await loadEnrolmentRows(client, { academicYearId: "y", classIds: ["c"], studentIds: ["a"], subjectIds: ["phy"] });
    expect(calls.every((c) => c.table === "student_subjects" && typeof c.select === "string")).toBe(true);
  });
});
