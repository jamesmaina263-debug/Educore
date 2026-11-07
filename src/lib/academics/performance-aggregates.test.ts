import { describe, expect, it } from "vitest";
import { groupRowToMark, studentRowToMark, type GroupAggregateRow, type StudentAggregateRow } from "./performance-aggregates";
import {
  buildEarlyWarnings,
  configFor,
  normaliseMarks,
  summarizeSchool,
  type GradeBand,
  type PctMark,
  type PerfMark,
  type SchoolFilter,
} from "./performance-analytics";

// Pins the central promise of database-side aggregation: for ANY set of marks and ANY filters, the
// pre-aggregated path (what the SQL functions return) gives exactly the same school summary and
// early-warning list as feeding every individual mark. The "SQL" here is simulated in TypeScript with the
// same grouping keys and measures as performance_group_aggregates / performance_student_aggregates.

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const CLASSES = ["Grade 1", "Grade 2", "Grade 3"];
const SUBJECTS = ["Maths", "English", "Science", "Kiswahili"];
const YEARS = [2023, 2024, 2025, 2026];
const LABELS = ["A", "B", "C", "D"];

function randomMarks(seed: number, kind: "percent" | "level", students = 40): PerfMark[] {
  const r = rng(seed);
  const out: PerfMark[] = [];
  let id = 0;
  for (let s = 0; s < students; s++) {
    const home = Math.floor(r() * CLASSES.length);
    for (const y of YEARS) {
      if (r() < 0.25) continue; // not enrolled / no data that year
      for (let t = 1; t <= 3; t++) {
        if (r() < 0.2) continue;
        for (let sj = 0; sj < SUBJECTS.length; sj++) {
          if (r() < 0.15) continue;
          const exams = 1 + Math.floor(r() * 2);
          for (let e = 0; e < exams; e++) {
            const cls = r() < 0.9 ? home : Math.floor(r() * CLASSES.length); // occasionally another class
            const common = {
              studentId: `s${s}`, classId: `c${cls}`, classLabel: CLASSES[cls], subjectId: `j${sj}`, subjectName: SUBJECTS[sj],
              yearId: `y${y}`, yearName: String(y), yearStart: `${y}-01-01`, termNumber: t, examId: `e${id++}`,
            };
            if (kind === "percent") {
              const max = r() < 0.5 ? 50 : 100;
              const missing = r() < 0.05;
              out.push({ ...common, kind, rawScore: missing ? null : Math.round(r() * max), maxScore: max, levelOrder: null, levelCount: null, levelPoints: null, levelLabel: null });
            } else {
              const order = 1 + Math.floor(r() * 4);
              out.push({ ...common, kind, rawScore: null, maxScore: null, levelOrder: order, levelCount: 4, levelPoints: null, levelLabel: LABELS[order - 1] });
            }
          }
        }
      }
    }
  }
  return out;
}

/** What performance_group_aggregates returns. */
function simulateGroupSql(marks: PctMark[]): GroupAggregateRow[] {
  const g = new Map<string, GroupAggregateRow>();
  for (const m of marks) {
    const key = [m.classId, m.subjectId, m.yearId, m.termNumber, m.kind, m.kind === "level" ? m.levelCount : ""].join("|");
    const row = g.get(key) ?? {
      class_id: m.classId, class_name: m.classLabel, subject_id: m.subjectId, subject_name: m.subjectName, year_id: m.yearId, year_name: m.yearName,
      year_start: m.yearStart, term_number: m.termNumber, kind: m.kind, grading_scale_id: null, level_count: m.kind === "level" ? m.levelCount : null, n: 0, score_sum: 0,
    };
    row.n = Number(row.n) + 1;
    row.score_sum = Number(row.score_sum) + m.score;
    g.set(key, row);
  }
  return [...g.values()];
}

/** What performance_student_aggregates returns, with the class/subject filter pushed down. */
function simulateStudentSql(marks: PctMark[], f: SchoolFilter): StudentAggregateRow[] {
  const g = new Map<string, StudentAggregateRow>();
  for (const m of marks) {
    if (f.classId && m.classId !== f.classId) continue;
    if (f.subjectId && m.subjectId !== f.subjectId) continue;
    const key = [m.studentId, m.classId, m.yearId, m.termNumber, m.kind, m.kind === "level" ? m.levelCount : ""].join("|");
    const row = g.get(key) ?? {
      student_id: m.studentId, class_id: m.classId, class_name: m.classLabel, year_id: m.yearId, year_name: m.yearName, year_start: m.yearStart,
      term_number: m.termNumber, kind: m.kind, grading_scale_id: null, level_count: m.kind === "level" ? m.levelCount : null, n: 0, score_sum: 0,
    };
    row.n = Number(row.n) + 1;
    row.score_sum = Number(row.score_sum) + m.score;
    g.set(key, row);
  }
  return [...g.values()];
}

const PERCENT_BANDS: GradeBand[] = [
  { label: "Excellent", min: 80, max: 100, order: 1 },
  { label: "Good", min: 60, max: 79.99, order: 2 },
  { label: "Average", min: 40, max: 59.99, order: 3 },
  { label: "Weak", min: 0, max: 39.99, order: 4 },
];
const LEVEL_BANDS: GradeBand[] = [
  { label: "A", min: 3.5, max: 4, order: 1 },
  { label: "B", min: 2.5, max: 3.49, order: 2 },
  { label: "C", min: 1.5, max: 2.49, order: 3 },
  { label: "D", min: 0.5, max: 1.49, order: 4 },
];

const FILTERS: SchoolFilter[] = [
  {},
  { yearId: "y2025" },
  { classId: "c1" },
  { subjectId: "j2" },
  { termNumber: 2 },
  { yearId: "y2024", classId: "c0", subjectId: "j1", termNumber: 3 },
  { classId: "c2", termNumber: 1 },
];

function close(a: unknown, b: unknown, path = "root") {
  if (typeof a === "number" && typeof b === "number") {
    expect(Math.abs(a - b), `${path}: ${a} vs ${b}`).toBeLessThan(1e-9);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    expect(a.length, `${path} length`).toBe(b.length);
    a.forEach((x, i) => close(x, b[i], `${path}[${i}]`));
  } else if (a && b && typeof a === "object" && typeof b === "object") {
    expect(Object.keys(a).sort(), `${path} keys`).toEqual(Object.keys(b).sort());
    for (const k of Object.keys(a)) close((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
  } else {
    expect(a, path).toEqual(b);
  }
}

describe.each([
  ["percent", configFor("percent"), PERCENT_BANDS],
  ["level", configFor("level", 4), LEVEL_BANDS],
] as const)("pre-aggregated path equals the per-mark path (%s marks)", (kind, cfg, bands) => {
  for (const seed of [1, 7, 42, 2026]) {
    const marks = normaliseMarks(randomMarks(seed, kind));
    for (const filter of FILTERS) {
      it(`seed ${seed}, filter ${JSON.stringify(filter)}`, () => {
        const direct = summarizeSchool(marks, filter, [...bands], cfg);

        const groups = simulateGroupSql(marks).map(groupRowToMark);
        const students = simulateStudentSql(marks, filter).map(studentRowToMark);
        const viaSql = summarizeSchool(students, filter, [...bands], cfg, 3, groups);

        close(viaSql, direct);

        // early warnings read the same student rows (scoped like the page does)
        const scoped = (m: PctMark) => (!filter.yearId || m.yearId === filter.yearId) && (!filter.classId || m.classId === filter.classId) && (!filter.subjectId || m.subjectId === filter.subjectId) && (!filter.termNumber || m.termNumber === filter.termNumber);
        const warnDirect = buildEarlyWarnings(marks.filter(scoped), cfg);
        const warnAgg = buildEarlyWarnings(students.filter((m) => (!filter.yearId || m.yearId === filter.yearId) && (!filter.classId || m.classId === filter.classId) && (!filter.termNumber || m.termNumber === filter.termNumber)), cfg);
        close(warnAgg, warnDirect);
      });
    }
  }
});

describe("aggregate row conversion", () => {
  it("turns a sum and count into a weighted mean row", () => {
    const m = groupRowToMark({
      class_id: "c", class_name: "Grade 1", subject_id: "j", subject_name: "Maths", year_id: "y", year_name: "2026", year_start: "2026-01-01",
      term_number: 1, kind: "percent", grading_scale_id: null, level_count: null, n: "4", score_sum: "300.5",
    });
    expect(m.weight).toBe(4);
    expect(m.score).toBeCloseTo(75.125);
  });

  it("keeps the number of levels on level rows and drops it on percent rows", () => {
    const row = { class_id: "c", class_name: "G", year_id: "y", year_name: "2026", year_start: "2026-01-01", term_number: 1, grading_scale_id: "g", n: 2, score_sum: 7, student_id: "s" };
    expect(studentRowToMark({ ...row, kind: "level", level_count: 4 }).levelCount).toBe(4);
    expect(studentRowToMark({ ...row, kind: "percent", level_count: 4 }).levelCount).toBeNull();
  });
});
