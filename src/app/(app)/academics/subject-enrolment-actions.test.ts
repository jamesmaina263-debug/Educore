import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory stand-in for the Supabase client: just enough of the query builder for these actions.
type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;
let db: Db;
let perms: Record<string, boolean>;
let failTable: string | null;
const writes: { op: string; table: string; rows?: Row[] }[] = [];

function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let mode: "select" | "delete" = "select";
  let limitN: number | null = null;
  let orderCol: { col: string; asc: boolean } | null = null;
  const run = () => {
    if (failTable === table) return { data: null, error: { message: `boom ${table}` } };
    let rows = (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
    if (mode === "delete") {
      writes.push({ op: "delete", table });
      db[table] = (db[table] ?? []).filter((r) => !rows.includes(r));
      return { data: null, error: null };
    }
    if (orderCol) rows = [...rows].sort((a, b) => (String(a[orderCol!.col]) < String(b[orderCol!.col]) ? -1 : 1) * (orderCol!.asc ? 1 : -1));
    if (limitN !== null) rows = rows.slice(0, limitN);
    return { data: rows, error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
    in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), b),
    lt: (c: string, v: string) => (filters.push((r) => String(r[c]) < v), b),
    not: (c: string, _o: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
    order: (c: string, o?: { ascending?: boolean }) => ((orderCol = { col: c, asc: o?.ascending !== false }), b),
    limit: (n: number) => ((limitN = n), b),
    range: () => b,
    delete: () => ((mode = "delete"), b),
    maybeSingle: () => {
      const r = run();
      return Promise.resolve({ data: (r.data as Row[] | null)?.[0] ?? null, error: r.error });
    },
    upsert: (rows: Row[], opts: { onConflict: string }) => {
      if (failTable === table) return Promise.resolve({ error: { message: `boom ${table}` } });
      writes.push({ op: "upsert", table, rows });
      const keys = opts.onConflict.split(",");
      for (const row of rows) {
        const i = (db[table] ??= []).findIndex((x) => keys.every((k) => x[k] === row[k]));
        if (i >= 0) db[table][i] = { ...db[table][i], ...row };
        else db[table].push(row);
      }
      return Promise.resolve({ error: null });
    },
    then: (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/observability/sentry-context", () => ({ setSentryRequestContext: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (t: string) => builder(t),
    rpc: async (name: string, args?: { p_permission_key?: string }) =>
      name === "auth_school_id" ? { data: "school1", error: null } : { data: perms[args?.p_permission_key ?? ""] === true, error: null },
  }),
}));

import { saveSubjectEnrolment, previewCopyFromLastYear, applyCopyFromLastYear } from "./subject-enrolment-actions";

const ss = (student: string, subject: string, year: string, active: boolean, cls: string): Row => ({
  school_id: "school1", student_id: student, subject_id: subject, academic_year_id: year, class_id: cls, is_active: active,
});

beforeEach(() => {
  writes.length = 0;
  failTable = null;
  perms = { "academics.write": true };
  db = {
    academic_years: [
      { id: "y25", name: "2025", start_date: "2025-01-01" },
      { id: "y26", name: "2026", start_date: "2026-01-01" },
    ],
    classes: [{ id: "c8", academic_year_id: "y26" }],
    streams: [{ id: "st8", class_id: "c8" }],
    students: ["a", "b", "c"].map((id) => ({ id, current_class_id: "st8", status: "active" })),
    subjects: [
      { id: "phy", name: "Physics", is_active: true },
      { id: "art", name: "Art", is_active: true },
      { id: "mat", name: "Maths", is_active: true },
    ],
    class_subjects: ["phy", "art", "mat"].map((s) => ({ stream_id: "st8", subject_id: s, subjects: { id: s, name: s, is_active: true } })),
    student_subjects: [
      // last year (another class): a and c took Physics, b did not; Maths was universal (no rows)
      ss("a", "phy", "y25", true, "c7"), ss("b", "phy", "y25", false, "c7"), ss("c", "phy", "y25", true, "c7"),
    ],
  };
});

describe("copy from last year actions", () => {
  it("preview lists what would be copied and writes nothing", async () => {
    const res = await previewCopyFromLastYear({ classId: "c8" });
    expect(res).toMatchObject({ previousYearName: "2025", classSize: 3, subjects: [{ subjectId: "phy", status: "copy", taking: 2, continuing: 2, dropped: 1, unknown: 0 }] });
    expect(writes).toHaveLength(0);
  });

  it("apply writes one row per student for the copied subject only, tagged with the class and this year", async () => {
    const res = await applyCopyFromLastYear({ classId: "c8", subjectIds: ["phy"] });
    expect(res).toEqual({ success: true, copied: 1 });
    const mine = db.student_subjects.filter((r) => r.academic_year_id === "y26");
    expect(mine.map((r) => [r.student_id, r.subject_id, r.is_active, r.class_id])).toEqual([
      ["a", "phy", true, "c8"], ["b", "phy", false, "c8"], ["c", "phy", true, "c8"],
    ]);
    expect(db.student_subjects.filter((r) => r.academic_year_id === "y25")).toHaveLength(3); // last year untouched
  });

  it("running it twice changes nothing the second time", async () => {
    await applyCopyFromLastYear({ classId: "c8", subjectIds: ["phy"] });
    const snapshot = JSON.stringify(db.student_subjects);
    expect(await previewCopyFromLastYear({ classId: "c8" })).toMatchObject({ subjects: [] });
    expect(await applyCopyFromLastYear({ classId: "c8", subjectIds: ["phy"] })).toEqual({ success: true, copied: 0 });
    expect(JSON.stringify(db.student_subjects)).toBe(snapshot);
  });

  it("never overwrites a subject staff already set up for this class", async () => {
    db.student_subjects.push(ss("a", "phy", "y26", false, "c8"), ss("b", "phy", "y26", true, "c8"), ss("c", "phy", "y26", true, "c8"));
    const before = JSON.stringify(db.student_subjects);
    expect(await applyCopyFromLastYear({ classId: "c8", subjectIds: ["phy"] })).toEqual({ success: true, copied: 0 });
    expect(JSON.stringify(db.student_subjects)).toBe(before);
  });

  it("only copies the subjects asked for", async () => {
    db.student_subjects.push(ss("a", "art", "y25", true, "c7"), ss("b", "art", "y25", false, "c7"), ss("c", "art", "y25", false, "c7"));
    await applyCopyFromLastYear({ classId: "c8", subjectIds: ["art"] });
    expect([...new Set(db.student_subjects.filter((r) => r.academic_year_id === "y26").map((r) => r.subject_id))]).toEqual(["art"]);
  });

  it("without academics.write nothing is read for writing and nothing is written", async () => {
    perms = {};
    expect(await applyCopyFromLastYear({ classId: "c8", subjectIds: ["phy"] })).toMatchObject({ error: expect.stringContaining("permission") });
    expect(await previewCopyFromLastYear({ classId: "c8" })).toMatchObject({ error: expect.stringContaining("permission") });
    expect(writes).toHaveLength(0);
  });

  it("stops without writing if it cannot tell what staff already set up", async () => {
    failTable = "student_subjects";
    const res = await applyCopyFromLastYear({ classId: "c8", subjectIds: ["phy"] });
    expect(res).toMatchObject({ error: expect.any(String) });
    expect(writes).toHaveLength(0);
  });

  it("explains when there is no earlier year", async () => {
    db.academic_years = [{ id: "y26", name: "2026", start_date: "2026-01-01" }];
    expect(await previewCopyFromLastYear({ classId: "c8" })).toMatchObject({ error: expect.stringContaining("earlier academic year") });
  });

  it("a nobody-continues subject is flagged and never written", async () => {
    db.student_subjects = ["a", "b", "c"].map((id) => ss(id, "phy", "y25", false, "c7"));
    expect(await previewCopyFromLastYear({ classId: "c8" })).toMatchObject({ subjects: [{ subjectId: "phy", status: "nobody_continues" }] });
    expect(await applyCopyFromLastYear({ classId: "c8", subjectIds: ["phy"] })).toEqual({ success: true, copied: 0 });
    expect(writes).toHaveLength(0);
  });
});

describe("saveSubjectEnrolment (shared write path)", () => {
  it("partial selection writes a row per active student; everyone removes the rows", async () => {
    expect(await saveSubjectEnrolment({ classId: "c8", subjectId: "art", takingStudentIds: ["a"] })).toEqual({ success: true, mode: "selected" });
    expect(db.student_subjects.filter((r) => r.subject_id === "art").map((r) => [r.student_id, r.is_active])).toEqual([["a", true], ["b", false], ["c", false]]);
    expect(await saveSubjectEnrolment({ classId: "c8", subjectId: "art", takingStudentIds: ["a", "b", "c"] })).toEqual({ success: true, mode: "everyone" });
    expect(db.student_subjects.filter((r) => r.subject_id === "art")).toHaveLength(0);
  });

  it("is refused without academics.write and writes nothing", async () => {
    perms = {};
    expect(await saveSubjectEnrolment({ classId: "c8", subjectId: "art", takingStudentIds: ["a"] })).toMatchObject({ error: expect.stringContaining("permission") });
    expect(writes).toHaveLength(0);
  });

  it("rejects a student who is not in the class", async () => {
    expect(await saveSubjectEnrolment({ classId: "c8", subjectId: "art", takingStudentIds: ["zzz"] })).toMatchObject({ error: expect.any(String) });
    expect(writes).toHaveLength(0);
  });
});
