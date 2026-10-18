// Pure model + calculation rules for the Class Mark Sheet document (PDF/Excel/CSV).
// No I/O. The server loader (load-mark-sheet.ts) gathers RLS-scoped rows and hands them here, and
// the PDF builder (lib/pdf/mark-sheet-pdf.ts) only lays out what this returns, so every number
// on the sheet comes from one tested place.
//
// Calculation rules (documented here because they are shown to teachers on the sheet):
//  * A mark is either numeric (raw_score) or competency-based (a band label with no score).
//  * A missing mark (no row) is NEVER treated as zero. It prints as an em dash and is excluded
//    from every statistic. A genuine score of 0 prints as "0" and is included.
//  * Total  = sum of the learner's entered numeric scores.
//  * Average and positions come straight from class_rankings (the same source the report cards
//    and portal read), so the sheet reconciles with them. They only exist for numeric exams.
//  * Subject mean = mean of ENTERED scores only (missing excluded), 1 decimal place.
//  * Competency-based exams get a band distribution per subject instead of a mean, and no
//    average/position: a band has no meaningful number to average (by design, see
//    20260730151614_exams_rankings_and_close.sql).
//  * A learner with fewer entered subjects than examined subjects is flagged incomplete.

export interface MarkSheetSchool {
  name: string;
  motto: string | null;
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  primaryColor: string | null;
}

export interface RawMarkSheetInput {
  school: MarkSheetSchool;
  exam: { name: string; examType: string; status: "open" | "closed"; termName: string | null; academicYearName: string | null };
  classLabel: string;
  subjects: { id: string; name: string; maxScore: number }[];
  students: { id: string; admissionNumber: string; firstName: string; lastName: string; otherNames: string | null; streamName: string }[];
  marks: { studentId: string; subjectId: string; rawScore: number | null; bandLabel: string | null; bandLevel: number | null }[];
  rankings: { studentId: string; totalScore: number; averageScore: number; rankInStream: number; rankInClass: number }[];
  generatedAt: string;
  preparedBy: string | null;
}

export type AssessmentKind = "numeric" | "cbc" | "mixed" | "empty";

export interface MarkSheetCell {
  /** What prints in the cell: score (+ grade code), a competency code, or an em dash when missing. */
  text: string;
  score: number | null;
  missing: boolean;
}

export interface MarkSheetLearner {
  no: number;
  admissionNumber: string;
  name: string;
  streamName: string;
  cells: Record<string, MarkSheetCell>;
  total: number | null;
  average: number | null;
  rankInStream: number | null;
  rankInClass: number | null;
  entered: number;
  expected: number;
  incomplete: boolean;
}

export interface SubjectStats {
  entered: number;
  missing: number;
  mean: number | null;
  highest: number | null;
  lowest: number | null;
  distribution: { code: string; count: number }[];
}

export interface MarkSheetModel {
  school: MarkSheetSchool;
  exam: RawMarkSheetInput["exam"];
  classLabel: string;
  preparedBy: string | null;
  generatedAt: string;
  kind: AssessmentKind;
  subjects: { id: string; name: string; maxScore: number }[];
  learners: MarkSheetLearner[];
  showRanking: boolean;
  multiStream: boolean;
  subjectStats: Record<string, SubjectStats>;
  classMean: number | null;
  legend: { code: string; meaning: string }[];
  provisional: boolean;
  incompleteCount: number;
}

export const MISSING = "—";

export function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** "A — Exceeding Expectation" -> { code: "A", meaning: "Exceeding Expectation" }; otherwise the label is its own code. */
export function splitBandLabel(label: string): { code: string; meaning: string | null } {
  const m = label.match(/^(.{1,6}?)\s+[—–-]\s+(.+)$/);
  return m ? { code: m[1].trim(), meaning: m[2].trim() } : { code: label.trim(), meaning: null };
}

export function buildMarkSheetModel(input: RawMarkSheetInput): MarkSheetModel {
  const marksByKey = new Map(input.marks.map((m) => [`${m.studentId}:${m.subjectId}`, m]));
  const rankByStudent = new Map(input.rankings.map((r) => [r.studentId, r]));

  const hasNumeric = input.marks.some((m) => m.rawScore !== null);
  const hasBandOnly = input.marks.some((m) => m.rawScore === null && m.bandLabel !== null);
  const kind: AssessmentKind = hasNumeric && hasBandOnly ? "mixed" : hasNumeric ? "numeric" : hasBandOnly ? "cbc" : "empty";

  const legendMap = new Map<string, string>();
  const noteBand = (label: string | null) => {
    if (!label) return null;
    const { code, meaning } = splitBandLabel(label);
    if (meaning && !legendMap.has(code)) legendMap.set(code, meaning);
    return code;
  };

  const expected = input.subjects.length;
  const streams = new Set(input.students.map((s) => s.streamName));

  const learners: MarkSheetLearner[] = input.students.map((s, i) => {
    const cells: Record<string, MarkSheetCell> = {};
    let total = 0;
    let entered = 0;
    let numericEntered = 0;
    for (const subject of input.subjects) {
      const m = marksByKey.get(`${s.id}:${subject.id}`);
      if (!m || (m.rawScore === null && m.bandLabel === null)) {
        cells[subject.id] = { text: MISSING, score: null, missing: true };
        continue;
      }
      entered += 1;
      const code = noteBand(m.bandLabel);
      if (m.rawScore !== null) {
        total += m.rawScore;
        numericEntered += 1;
        cells[subject.id] = { text: code ? `${m.rawScore} ${code}` : String(m.rawScore), score: m.rawScore, missing: false };
      } else {
        cells[subject.id] = { text: code ?? MISSING, score: null, missing: false };
      }
    }
    const rk = rankByStudent.get(s.id);
    return {
      no: i + 1,
      admissionNumber: s.admissionNumber,
      name: [s.firstName, s.otherNames, s.lastName].filter(Boolean).join(" "),
      streamName: s.streamName,
      cells,
      total: numericEntered > 0 ? round(total, 2) : null,
      average: rk ? round(rk.averageScore, 2) : null,
      rankInStream: rk?.rankInStream ?? null,
      rankInClass: rk?.rankInClass ?? null,
      entered,
      expected,
      incomplete: entered < expected,
    };
  });

  const subjectStats: Record<string, SubjectStats> = {};
  for (const subject of input.subjects) {
    const scores: number[] = [];
    const counts = new Map<string, { count: number; level: number }>();
    let entered = 0;
    for (const s of input.students) {
      const m = marksByKey.get(`${s.id}:${subject.id}`);
      if (!m || (m.rawScore === null && m.bandLabel === null)) continue;
      entered += 1;
      if (m.rawScore !== null) scores.push(m.rawScore);
      else if (m.bandLabel) {
        const { code } = splitBandLabel(m.bandLabel);
        const cur = counts.get(code) ?? { count: 0, level: m.bandLevel ?? 0 };
        cur.count += 1;
        counts.set(code, cur);
      }
    }
    subjectStats[subject.id] = {
      entered,
      missing: input.students.length - entered,
      mean: scores.length ? round(scores.reduce((a, b) => a + b, 0) / scores.length, 1) : null,
      highest: scores.length ? Math.max(...scores) : null,
      lowest: scores.length ? Math.min(...scores) : null,
      // Higher level_order = higher achievement (see report-card-insights), so list best band first.
      distribution: [...counts.entries()].sort((a, b) => b[1].level - a[1].level).map(([code, v]) => ({ code, count: v.count })),
    };
  }

  const averages = learners.map((l) => l.average).filter((a): a is number => a !== null);
  const showRanking = kind === "numeric" && averages.length > 0;

  return {
    school: input.school,
    exam: input.exam,
    classLabel: input.classLabel,
    preparedBy: input.preparedBy,
    generatedAt: input.generatedAt,
    kind,
    subjects: input.subjects,
    learners,
    showRanking,
    multiStream: streams.size > 1,
    subjectStats,
    classMean: showRanking ? round(averages.reduce((a, b) => a + b, 0) / averages.length, 2) : null,
    legend: [...legendMap.entries()].map(([code, meaning]) => ({ code, meaning })),
    provisional: input.exam.status !== "closed",
    incompleteCount: learners.filter((l) => l.incomplete).length,
  };
}

/** Flat rows for Excel/CSV, from the SAME model so the downloads reconcile with the PDF. */
export function markSheetExportRows(model: MarkSheetModel): Record<string, string | number>[] {
  const numeric = model.kind === "numeric" || model.kind === "mixed";
  return model.learners.map((l) => {
    const row: Record<string, string | number> = { "Adm No": l.admissionNumber, Student: l.name };
    if (model.multiStream) row["Stream"] = l.streamName;
    for (const subject of model.subjects) {
      const cell = l.cells[subject.id];
      row[subject.name] = cell.score !== null ? cell.score : cell.text;
    }
    if (numeric) row["Total"] = l.total ?? MISSING;
    if (model.showRanking) {
      row["Average"] = l.average ?? MISSING;
      row["Position"] = l.rankInStream ?? MISSING;
    }
    return row;
  });
}
