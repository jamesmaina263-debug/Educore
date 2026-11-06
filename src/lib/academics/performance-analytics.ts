// Academic Performance Analytics: pure calculation layer.
//
// Everything here takes already-fetched rows and returns numbers. No Supabase,
// no React -- same convention as growth-trend.ts so each rule is unit-tested
// (performance-analytics.test.ts) instead of only checkable through the UI.
//
// Calculation rules (from the module spec):
//  1. Every mark is converted to a percentage of ITS OWN maximum, so papers
//     out of 50 and out of 100 are comparable.
//  2. A missing mark (null score) or an unusable maximum is EXCLUDED, never
//     counted as zero.
//  3. A year/subject average is the mean of its valid assessment percentages.
//     The schema has no per-exam weighting, so assessments weigh equally.
//  4. Year-on-year change is in PERCENTAGE POINTS (60% -> 75% is +15 pp).
//  5. A year with fewer than `expectedTerms` terms of results is flagged
//     `incomplete` rather than silently compared as if it were whole.
//  6. Nothing is invented: no data means null / empty, never a default value.

import { classifyTrend, type TrendDirection } from "@/lib/academics/growth-trend";

export const DEFAULT_EXPECTED_TERMS = 3;
/** School-wide "needs intervention" threshold (percent) when the school has not configured one. */
export const DEFAULT_INTERVENTION_THRESHOLD = 50;

export interface PerfMark {
  studentId: string;
  classId: string;
  classLabel: string;
  subjectId: string;
  subjectName: string;
  yearId: string;
  yearName: string;
  /** ISO date of the academic year start; used for chronological ordering. */
  yearStart: string;
  termNumber: number;
  examId: string;
  rawScore: number | null;
  maxScore: number | null;
}

export interface PctMark extends PerfMark {
  percentage: number;
}

export interface YearPoint {
  yearId: string;
  yearName: string;
  yearStart: string;
  average: number;
  assessments: number;
  termsCovered: number[];
  /** True when fewer than the expected number of terms have results. */
  incomplete: boolean;
  /** Percentage-point change versus the previous tracked year; null for the first year. */
  changeFromPrevious: number | null;
}

export interface HistorySummary {
  yearsTracked: number;
  /** Last tracked year minus first tracked year, in percentage points. Null with fewer than 2 years. */
  growthSinceEnrolment: number | null;
  highestYear: YearPoint | null;
  lowestYear: YearPoint | null;
  /** Mean of every valid assessment across all tracked years. */
  historicalAverage: number | null;
  trend: TrendDirection;
}

export const round1 = (n: number): number => Math.round(n * 10) / 10;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Converts raw marks to percentages, dropping anything that cannot be normalised. */
export function normaliseMarks(marks: PerfMark[]): PctMark[] {
  const out: PctMark[] = [];
  for (const m of marks) {
    if (m.rawScore === null || m.maxScore === null) continue;
    if (!Number.isFinite(m.rawScore) || !Number.isFinite(m.maxScore) || m.maxScore <= 0 || m.rawScore < 0) continue;
    out.push({ ...m, percentage: (m.rawScore / m.maxScore) * 100 });
  }
  return out;
}

function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}

/** One point per academic year, chronological, with percentage-point change from the previous year. */
export function buildYearlySeries(marks: PctMark[], expectedTerms = DEFAULT_EXPECTED_TERMS): YearPoint[] {
  const points: YearPoint[] = [];
  for (const [yearId, rows] of groupBy(marks, (m) => m.yearId)) {
    const avg = mean(rows.map((r) => r.percentage));
    if (avg === null) continue;
    const terms = [...new Set(rows.map((r) => r.termNumber))].sort((a, b) => a - b);
    points.push({
      yearId,
      yearName: rows[0].yearName,
      yearStart: rows[0].yearStart,
      average: avg,
      assessments: rows.length,
      termsCovered: terms,
      incomplete: terms.length < expectedTerms,
      changeFromPrevious: null,
    });
  }
  points.sort((a, b) => a.yearStart.localeCompare(b.yearStart));
  for (let i = 1; i < points.length; i++) {
    points[i].changeFromPrevious = points[i].average - points[i - 1].average;
  }
  return points;
}

export function summarizeHistory(marks: PctMark[], points: YearPoint[]): HistorySummary {
  if (points.length === 0) {
    return { yearsTracked: 0, growthSinceEnrolment: null, highestYear: null, lowestYear: null, historicalAverage: null, trend: "insufficient_data" };
  }
  const highest = points.reduce((a, b) => (b.average > a.average ? b : a));
  const lowest = points.reduce((a, b) => (b.average < a.average ? b : a));
  const trend = classifyTrend(points.map((p) => ({ label: p.yearName, value: p.average })));
  return {
    yearsTracked: points.length,
    growthSinceEnrolment: points.length >= 2 ? points[points.length - 1].average - points[0].average : null,
    highestYear: highest,
    lowestYear: lowest,
    historicalAverage: mean(marks.map((m) => m.percentage)),
    trend: trend.direction,
  };
}

export interface SubjectProgression {
  subjectId: string;
  subjectName: string;
  points: YearPoint[];
  direction: TrendDirection;
  change: number | null;
}

/** Per-subject yearly series, e.g. Mathematics from enrolment to now. */
export function buildSubjectProgression(marks: PctMark[], expectedTerms = DEFAULT_EXPECTED_TERMS): SubjectProgression[] {
  const result: SubjectProgression[] = [];
  for (const [subjectId, rows] of groupBy(marks, (m) => m.subjectId)) {
    const points = buildYearlySeries(rows, expectedTerms);
    const trend = classifyTrend(points.map((p) => ({ label: p.yearName, value: p.average })));
    result.push({ subjectId, subjectName: rows[0].subjectName, points, direction: trend.direction, change: trend.change });
  }
  return result.sort((a, b) => a.subjectName.localeCompare(b.subjectName));
}

export interface TermAverage {
  termNumber: number;
  average: number;
  assessments: number;
}

export function buildTermAverages(marks: PctMark[]): TermAverage[] {
  return [...groupBy(marks, (m) => m.termNumber)]
    .map(([termNumber, rows]) => ({ termNumber, average: mean(rows.map((r) => r.percentage)) as number, assessments: rows.length }))
    .sort((a, b) => a.termNumber - b.termNumber);
}

// ---------------------------------------------------------------- school-wide

export interface GradeBand {
  label: string;
  /** Inclusive lower bound in percent. */
  min: number;
  /** Inclusive upper bound in percent. */
  max: number;
  order: number;
}

export interface SchoolFilter {
  yearId?: string;
  classId?: string;
  subjectId?: string;
  termNumber?: number;
}

export interface NamedAverage {
  id: string;
  label: string;
  average: number;
  assessments: number;
}

export interface SubjectAverage extends NamedAverage {
  /** Percentage-point change between the two most recent years the subject has results in; null if only one. */
  change: number | null;
  needsIntervention: boolean;
}

export type MatrixRow = { year: string } & Record<string, string | number>;

export interface SchoolSummary {
  overallAverage: number | null;
  studentsAssessed: number;
  improving: number;
  declining: number;
  consistent: number;
  /** Students with results in fewer than two years: not labelled either way. */
  insufficientHistory: number;
  classAverages: NamedAverage[];
  bestClass: NamedAverage | null;
  weakestClass: NamedAverage | null;
  subjectAverages: SubjectAverage[];
  bestSubject: SubjectAverage | null;
  weakestSubject: SubjectAverage | null;
  yearAverages: YearPoint[];
  termAverages: TermAverage[];
  distribution: { label: string; count: number }[];
  /** One row per assessed student (after filters), with the configured category their average falls in. */
  students: { studentId: string; average: number; band: string | null }[];
  /** Grouped-bar data: one row per year, one column per class / subject. Gaps are absent, never zero. */
  classByYear: MatrixRow[];
  subjectByYear: MatrixRow[];
  /** Students whose averages fall in no configured band (e.g. gaps in the scale). */
  unbanded: number;
}

function applyFilter(marks: PctMark[], f: SchoolFilter, skipYear: boolean): PctMark[] {
  return marks.filter(
    (m) =>
      (skipYear || !f.yearId || m.yearId === f.yearId) &&
      (!f.classId || m.classId === f.classId) &&
      (!f.subjectId || m.subjectId === f.subjectId) &&
      (!f.termNumber || m.termNumber === f.termNumber),
  );
}

function bandFor(average: number, bands: GradeBand[]): GradeBand | null {
  // Round to 2dp so 49.999... does not fall through a 50.00 boundary.
  const v = Math.round(average * 100) / 100;
  return bands.find((b) => v >= b.min && v <= b.max) ?? null;
}

function toNamed(groups: Map<string, PctMark[]>, label: (rows: PctMark[]) => string): NamedAverage[] {
  return [...groups].map(([id, rows]) => ({
    id,
    label: label(rows),
    average: mean(rows.map((r) => r.percentage)) as number,
    assessments: rows.length,
  }));
}

export function summarizeSchool(
  allMarks: PctMark[],
  filter: SchoolFilter = {},
  bands: GradeBand[] = [],
  interventionThreshold = DEFAULT_INTERVENTION_THRESHOLD,
  expectedTerms = DEFAULT_EXPECTED_TERMS,
): SchoolSummary {
  const scoped = applyFilter(allMarks, filter, false);
  // Trend labels need every year, so they ignore the year filter.
  const history = applyFilter(allMarks, filter, true);

  const byStudent = groupBy(scoped, (m) => m.studentId);
  const studentAverages = [...byStudent].map(([studentId, rows]) => ({ studentId, average: mean(rows.map((r) => r.percentage)) as number }));

  let improving = 0;
  let declining = 0;
  let consistent = 0;
  let insufficientHistory = 0;
  for (const [, rows] of groupBy(history, (m) => m.studentId)) {
    const series = buildYearlySeries(rows, expectedTerms);
    const dir = classifyTrend(series.map((p) => ({ label: p.yearName, value: p.average }))).direction;
    if (dir === "improving") improving++;
    else if (dir === "declining") declining++;
    else if (dir === "stable") consistent++;
    else insufficientHistory++;
  }

  const classAverages = toNamed(groupBy(scoped, (m) => m.classId), (r) => r[0].classLabel).sort((a, b) => b.average - a.average);

  const subjectAverages: SubjectAverage[] = toNamed(groupBy(scoped, (m) => m.subjectId), (r) => r[0].subjectName)
    .map((s) => {
      const rows = history.filter((m) => m.subjectId === s.id);
      const series = buildYearlySeries(rows, expectedTerms);
      const change = series.length >= 2 ? series[series.length - 1].average - series[series.length - 2].average : null;
      const needsIntervention = s.average < interventionThreshold || (change !== null && change <= -5);
      return { ...s, change, needsIntervention };
    })
    .sort((a, b) => b.average - a.average);

  const sortedBands = [...bands].sort((a, b) => a.order - b.order);
  const dist = new Map<string, number>(sortedBands.map((b) => [b.label, 0]));
  let unbanded = 0;
  for (const s of studentAverages) {
    const band = bandFor(s.average, sortedBands);
    if (band) dist.set(band.label, (dist.get(band.label) ?? 0) + 1);
    else unbanded++;
  }

  const students = studentAverages.map((a) => ({ ...a, band: bandFor(a.average, sortedBands)?.label ?? null }));

  return {
    students,
    classByYear: buildMatrix(history, (m) => m.classLabel),
    subjectByYear: buildMatrix(history, (m) => m.subjectName),
    overallAverage: mean(scoped.map((m) => m.percentage)),
    studentsAssessed: studentAverages.length,
    improving,
    declining,
    consistent,
    insufficientHistory,
    classAverages,
    bestClass: classAverages[0] ?? null,
    weakestClass: classAverages.length > 0 ? classAverages[classAverages.length - 1] : null,
    subjectAverages,
    bestSubject: subjectAverages[0] ?? null,
    weakestSubject: subjectAverages.length > 0 ? subjectAverages[subjectAverages.length - 1] : null,
    yearAverages: buildYearlySeries(history, expectedTerms),
    termAverages: buildTermAverages(scoped),
    distribution: [...dist].map(([label, count]) => ({ label, count })),
    unbanded,
  };
}

/** Year x category averages for grouped bars (e.g. each class across years). Absent cells stay absent. */
export function buildMatrix(marks: PctMark[], category: (m: PctMark) => string): MatrixRow[] {
  const years = [...new Map(marks.map((m) => [m.yearId, m])).values()].sort((a, b) => a.yearStart.localeCompare(b.yearStart));
  return years.map((y) => {
    const row: MatrixRow = { year: y.yearName };
    for (const [cat, rows] of groupBy(
      marks.filter((m) => m.yearId === y.yearId),
      category,
    )) {
      row[cat] = round1(mean(rows.map((r) => r.percentage)) as number);
    }
    return row;
  });
}

// ------------------------------------------------------------------ early warning

export type WarningFlag = "declining" | "consistently_low" | "improving" | "stagnant" | "below_threshold";

export interface EarlyWarningRow {
  studentId: string;
  /** Most recent term average on file. */
  latestAverage: number;
  /** Percentage-point change from the first to the latest term on file; null with one term. */
  change: number | null;
  termsOnFile: number;
  assessments: number;
  flags: WarningFlag[];
}

export interface EarlyWarningOptions {
  threshold?: number;
  /** A student with fewer valid assessments than this is never flagged: incomplete records are not evidence. */
  minAssessments?: number;
  /** Change (pp) from first to latest term that counts as significant improvement. */
  significantImprovement?: number;
  /** Max spread (pp) across 3+ terms that counts as stagnant. */
  stagnantSpread?: number;
}

/**
 * Early-warning flags per student from their TERM-level averages (so a first-year student can be
 * flagged within the year). Students with too few valid assessments are skipped entirely rather than
 * labelled weak on incomplete records. Flags are indicators for a teacher to investigate, not verdicts.
 */
export function buildEarlyWarnings(marks: PctMark[], opts: EarlyWarningOptions = {}): EarlyWarningRow[] {
  const threshold = opts.threshold ?? DEFAULT_INTERVENTION_THRESHOLD;
  const minAssessments = opts.minAssessments ?? 3;
  const bigGain = opts.significantImprovement ?? 10;
  const spread = opts.stagnantSpread ?? 3;
  const rows: EarlyWarningRow[] = [];

  for (const [studentId, own] of groupBy(marks, (m) => m.studentId)) {
    if (own.length < minAssessments) continue;
    const byTerm = [...groupBy(own, (m) => `${m.yearStart}|${m.termNumber}`)]
      .map(([key, r]) => ({ key, average: mean(r.map((x) => x.percentage)) as number }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const values = byTerm.map((t) => t.average);
    const latest = values[values.length - 1];
    const change = values.length >= 2 ? latest - values[0] : null;
    const flags: WarningFlag[] = [];

    const direction = classifyTrend(byTerm.map((t) => ({ label: t.key, value: t.average }))).direction;
    if (direction === "declining") flags.push("declining");
    if (change !== null && change >= bigGain) flags.push("improving");
    if (values.length >= 2 && values.every((v) => v < threshold)) flags.push("consistently_low");
    if (values.length >= 3 && Math.max(...values) - Math.min(...values) <= spread) flags.push("stagnant");
    if (latest < threshold) flags.push("below_threshold");

    if (flags.length > 0) rows.push({ studentId, latestAverage: latest, change, termsOnFile: values.length, assessments: own.length, flags });
  }
  return rows.sort((a, b) => a.latestAverage - b.latestAverage);
}

/** Share of recorded school days attended. Late counts as attended. Null when there are no records. */
export function attendancePercentage(present: number, late: number, absent: number): number | null {
  const total = present + late + absent;
  return total === 0 ? null : ((present + late) / total) * 100;
}
