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
//  3. A year/subject average is the mean of its valid assessment scores.
//     The schema has no per-exam weighting, so assessments weigh equally.
//  4. Year-on-year change is in score points: PERCENTAGE POINTS for percent marks (60% -> 75% is +15 pp).
//  5. A year with fewer than `expectedTerms` terms of results is flagged
//     `incomplete` rather than silently compared as if it were whole.
//  6. Nothing is invented: no data means null / empty, never a default value.

import { classifyTrend, type TrendDirection } from "@/lib/academics/growth-trend";

export const DEFAULT_EXPECTED_TERMS = 3;
/** School-wide "needs intervention" threshold (percent) when none is chosen. */
export const DEFAULT_INTERVENTION_THRESHOLD = 50;

// Two assessment models exist in EduCore and they are NEVER mixed in one average:
//  - "percent": numeric marks, converted to a percentage of each paper's own maximum;
//  - "level":   CBC band marks (e.g. A-D). A level has no percentage, so it is scored in LEVEL POINTS:
//               the scale's own `points` when it has them, otherwise rank-derived points where the best
//               level scores the number of levels and the worst scores 1 (A=4 ... D=1 on a 4-level scale).
export type ScoreKind = "percent" | "level";

export interface AnalyticsConfig {
  kind: ScoreKind;
  /** Lowest and highest possible score on this scale. */
  min: number;
  max: number;
  unit: string;
  /** A change smaller than or equal to this (in score units) reads as stable. */
  stable: number;
  /** Averages below this need attention. Defaults to the scale midpoint. */
  threshold: number;
  /** First-to-latest term change that counts as a significant improvement. */
  significantImprovement: number;
  /** Max spread across 3+ terms that counts as stagnant. */
  stagnantSpread: number;
}

export function configFor(kind: ScoreKind, maxLevels = 4, threshold?: number): AnalyticsConfig {
  if (kind === "percent") {
    return { kind, min: 0, max: 100, unit: "%", stable: 5, threshold: threshold ?? DEFAULT_INTERVENTION_THRESHOLD, significantImprovement: 10, stagnantSpread: 3 };
  }
  const levels = Math.max(2, maxLevels);
  return { kind, min: 1, max: levels, unit: " pts", stable: 0.25, threshold: threshold ?? (1 + levels) / 2, significantImprovement: 0.5, stagnantSpread: 0.15 };
}

/** Points for a CBC level: the scale's own points when present, else best level = levelCount ... worst = 1. */
export function levelPoints(points: number | null, levelOrder: number, levelCount: number): number {
  return points !== null && Number.isFinite(points) ? points : levelCount - levelOrder + 1;
}

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
  /** Display name of the exam, when known (used for the mark-by-mark table). */
  examName?: string;
  kind: ScoreKind;
  /** percent marks */
  rawScore: number | null;
  maxScore: number | null;
  /** level marks: 1 = best level; levelCount = number of levels on that mark's scale */
  levelOrder: number | null;
  levelCount: number | null;
  levelPoints: number | null;
  levelLabel: string | null;
  /** Grading scale the level belongs to (set on database-aggregated rows, used to build category bands). */
  scaleId?: string | null;
}

/** A mark reduced to one comparable number: a percentage, or level points. */
export interface PctMark extends PerfMark {
  score: number;
  /**
   * How many individual marks this row stands for. Absent (= 1) for a single mark; set when the database
   * has already summed marks (score is then their mean), so every average below is a weighted mean and a
   * pre-aggregated input gives exactly the same answer as the individual marks would.
   */
  weight?: number;
}
export type ScoredMark = PctMark;

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
  /** Last tracked year minus first tracked year, in score points (percentage points for percent marks). Null with fewer than 2 years. */
  growthSinceEnrolment: number | null;
  highestYear: YearPoint | null;
  lowestYear: YearPoint | null;
  /** Mean of every valid assessment across all tracked years. */
  historicalAverage: number | null;
  trend: TrendDirection;
}

export const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Number of individual marks a set of rows stands for. */
export const wcount = (rows: PctMark[]): number => rows.reduce((a, r) => a + (r.weight ?? 1), 0);

/** Mean score of a set of rows, each counted as many times as its weight. Null when empty. */
export function wmean(rows: PctMark[]): number | null {
  const n = wcount(rows);
  return n === 0 ? null : rows.reduce((a, r) => a + r.score * (r.weight ?? 1), 0) / n;
}

/** Reduces marks to one comparable score each, dropping anything that cannot be scored honestly. */
export function normaliseMarks(marks: PerfMark[]): PctMark[] {
  const out: PctMark[] = [];
  for (const m of marks) {
    if (m.kind === "level") {
      const { levelOrder: o, levelCount: c } = m;
      if (o === null || c === null || !Number.isInteger(o) || !Number.isInteger(c) || o < 1 || o > c) continue;
      out.push({ ...m, score: levelPoints(m.levelPoints, o, c) });
      continue;
    }
    if (m.rawScore === null || m.maxScore === null) continue;
    if (!Number.isFinite(m.rawScore) || !Number.isFinite(m.maxScore) || m.maxScore <= 0 || m.rawScore < 0) continue;
    out.push({ ...m, score: (m.rawScore / m.maxScore) * 100 });
  }
  return out;
}

interface LevelEntry {
  label: string;
  order: number;
  count: number;
  points: number | null;
}

function bandsFromLevels(entries: LevelEntry[]): GradeBand[] {
  const seen = new Map<string, GradeBand>();
  for (const e of entries) {
    if (seen.has(e.label)) continue;
    const p = levelPoints(e.points, e.order, e.count);
    seen.set(e.label, { label: e.label, min: p - 0.5, max: p + 0.49, order: e.order });
  }
  const bands = [...seen.values()].sort((a, b) => a.order - b.order);
  if (bands.length > 0) {
    bands[0].max = Math.max(bands[0].max, bands[0].min + 0.99); // best level absorbs the top edge
    bands[bands.length - 1].min = Math.min(bands[bands.length - 1].min, 0.5); // worst level absorbs the bottom edge
  }
  return bands;
}

/** Bands for the category breakdown of a LEVEL scale: each level owns the half-point either side of its points. */
export function levelBands(marks: PctMark[]): GradeBand[] {
  return bandsFromLevels(
    marks
      .filter((m) => m.kind === "level" && m.levelOrder !== null && m.levelCount !== null && !!m.levelLabel)
      .map((m) => ({ label: m.levelLabel as string, order: m.levelOrder as number, count: m.levelCount as number, points: m.levelPoints })),
  );
}

/** The same bands straight from a grading scale's own levels (used when marks arrive pre-aggregated by the database). */
export function levelBandsFromScale(levels: { label: string; level_order: number; points: number | string | null }[]): GradeBand[] {
  const count = Math.max(0, ...levels.map((l) => l.level_order));
  return bandsFromLevels(levels.map((l) => ({ label: l.label, order: l.level_order, count, points: l.points === null ? null : Number(l.points) })));
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

/** One point per academic year, chronological, with change (score points) from the previous year. */
export function buildYearlySeries(marks: PctMark[], expectedTerms = DEFAULT_EXPECTED_TERMS): YearPoint[] {
  const points: YearPoint[] = [];
  for (const [yearId, rows] of groupBy(marks, (m) => m.yearId)) {
    const avg = wmean(rows);
    if (avg === null) continue;
    const terms = [...new Set(rows.map((r) => r.termNumber))].sort((a, b) => a - b);
    points.push({
      yearId,
      yearName: rows[0].yearName,
      yearStart: rows[0].yearStart,
      average: avg,
      assessments: wcount(rows),
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

export function summarizeHistory(marks: PctMark[], points: YearPoint[], cfg: AnalyticsConfig = configFor("percent")): HistorySummary {
  if (points.length === 0) {
    return { yearsTracked: 0, growthSinceEnrolment: null, highestYear: null, lowestYear: null, historicalAverage: null, trend: "insufficient_data" };
  }
  const highest = points.reduce((a, b) => (b.average > a.average ? b : a));
  const lowest = points.reduce((a, b) => (b.average < a.average ? b : a));
  const trend = classifyTrend(points.map((p) => ({ label: p.yearName, value: p.average })), cfg.stable);
  return {
    yearsTracked: points.length,
    growthSinceEnrolment: points.length >= 2 ? points[points.length - 1].average - points[0].average : null,
    highestYear: highest,
    lowestYear: lowest,
    historicalAverage: wmean(marks),
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
export function buildSubjectProgression(marks: PctMark[], expectedTerms = DEFAULT_EXPECTED_TERMS, stable = 5): SubjectProgression[] {
  const result: SubjectProgression[] = [];
  for (const [subjectId, rows] of groupBy(marks, (m) => m.subjectId)) {
    const points = buildYearlySeries(rows, expectedTerms);
    const trend = classifyTrend(points.map((p) => ({ label: p.yearName, value: p.average })), stable);
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
    .map(([termNumber, rows]) => ({ termNumber, average: wmean(rows) as number, assessments: wcount(rows) }))
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

function applyFilter(marks: PctMark[], f: SchoolFilter, skipYear: boolean, ignoreSubject = false): PctMark[] {
  return marks.filter(
    (m) =>
      (skipYear || !f.yearId || m.yearId === f.yearId) &&
      (!f.classId || m.classId === f.classId) &&
      (ignoreSubject || !f.subjectId || m.subjectId === f.subjectId) &&
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
    average: wmean(rows) as number,
    assessments: wcount(rows),
  }));
}

export function summarizeSchool(
  allMarks: PctMark[],
  filter: SchoolFilter = {},
  bands: GradeBand[] = [],
  cfg: AnalyticsConfig = configFor("percent"),
  expectedTerms = DEFAULT_EXPECTED_TERMS,
  groupMarks?: PctMark[],
): SchoolSummary {
  // Two input shapes give identical results:
  //  * per-mark: `allMarks` is every mark (student + class + subject on each);
  //  * pre-aggregated by the database (performance_*_aggregates): `allMarks` are STUDENT rows (student x class x
  //    year x term, already limited to the chosen subject, so the subject filter is not re-applied to them) and
  //    `groupMarks` are CLASS x SUBJECT rows (year x term). Student figures use the first, class/subject/year/term
  //    figures use the second. Rows carry a weight, so the means are exact.
  const aggregated = groupMarks !== undefined;
  const scoped = applyFilter(allMarks, filter, false, aggregated);
  // Trend labels need every year, so they ignore the year filter.
  const history = applyFilter(allMarks, filter, true, aggregated);
  const groupScoped = aggregated ? applyFilter(groupMarks, filter, false) : scoped;
  const groupHistory = aggregated ? applyFilter(groupMarks, filter, true) : history;

  const byStudent = groupBy(scoped, (m) => m.studentId);
  const studentAverages = [...byStudent].map(([studentId, rows]) => ({ studentId, average: wmean(rows) as number }));

  let improving = 0;
  let declining = 0;
  let consistent = 0;
  let insufficientHistory = 0;
  for (const [, rows] of groupBy(history, (m) => m.studentId)) {
    const series = buildYearlySeries(rows, expectedTerms);
    const dir = classifyTrend(series.map((p) => ({ label: p.yearName, value: p.average })), cfg.stable).direction;
    if (dir === "improving") improving++;
    else if (dir === "declining") declining++;
    else if (dir === "stable") consistent++;
    else insufficientHistory++;
  }

  const classAverages = toNamed(groupBy(groupScoped, (m) => m.classId), (r) => r[0].classLabel).sort((a, b) => b.average - a.average);

  const subjectAverages: SubjectAverage[] = toNamed(groupBy(groupScoped, (m) => m.subjectId), (r) => r[0].subjectName)
    .map((s) => {
      const rows = groupHistory.filter((m) => m.subjectId === s.id);
      const series = buildYearlySeries(rows, expectedTerms);
      const change = series.length >= 2 ? series[series.length - 1].average - series[series.length - 2].average : null;
      const needsIntervention = s.average < cfg.threshold || (change !== null && change < -cfg.stable);
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
    classByYear: buildMatrix(groupHistory, (m) => m.classLabel),
    subjectByYear: buildMatrix(groupHistory, (m) => m.subjectName),
    overallAverage: wmean(groupScoped),
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
    yearAverages: buildYearlySeries(groupHistory, expectedTerms),
    termAverages: buildTermAverages(groupScoped),
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
      row[cat] = round1(wmean(rows) as number);
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

/**
 * Early-warning flags per student from their TERM-level averages (so a first-year student can be
 * flagged within the year). Students with too few valid assessments are skipped entirely rather than
 * labelled weak on incomplete records. Flags are indicators for a teacher to investigate, not verdicts.
 * Thresholds come from the scale config (percent or CBC level points).
 */
export function buildEarlyWarnings(marks: PctMark[], cfg: AnalyticsConfig = configFor("percent"), minAssessments = 3): EarlyWarningRow[] {
  const rows: EarlyWarningRow[] = [];

  for (const [studentId, own] of groupBy(marks, (m) => m.studentId)) {
    if (wcount(own) < minAssessments) continue;
    const byTerm = [...groupBy(own, (m) => `${m.yearStart}|${m.termNumber}`)]
      .map(([key, r]) => ({ key, average: wmean(r) as number }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const values = byTerm.map((t) => t.average);
    const latest = values[values.length - 1];
    const change = values.length >= 2 ? latest - values[0] : null;
    const flags: WarningFlag[] = [];

    const direction = classifyTrend(byTerm.map((t) => ({ label: t.key, value: t.average })), cfg.stable).direction;
    if (direction === "declining") flags.push("declining");
    if (change !== null && change >= cfg.significantImprovement) flags.push("improving");
    if (values.length >= 2 && values.every((v) => v < cfg.threshold)) flags.push("consistently_low");
    if (values.length >= 3 && Math.max(...values) - Math.min(...values) <= cfg.stagnantSpread) flags.push("stagnant");
    if (latest < cfg.threshold) flags.push("below_threshold");

    if (flags.length > 0) rows.push({ studentId, latestAverage: latest, change, termsOnFile: values.length, assessments: wcount(own), flags });
  }
  return rows.sort((a, b) => a.latestAverage - b.latestAverage);
}

/** Share of recorded school days attended. Late counts as attended. Null when there are no records. */
export function attendancePercentage(present: number, late: number, absent: number): number | null {
  const total = present + late + absent;
  return total === 0 ? null : ((present + late) / total) * 100;
}

// ------------------------------------------------------------------ display helpers

/** "72.5%" for percent marks, "2.75 pts" for CBC level points. Null shows an em dash, never a zero. */
export function formatScore(n: number | null | undefined, cfg: AnalyticsConfig): string {
  if (n === null || n === undefined) return "—";
  return cfg.kind === "percent" ? `${round1(n)}%` : `${Math.round(n * 100) / 100} pts`;
}

/** Signed change: "+5 pp" for percent marks (percentage points), "+0.5 pts" for CBC level points. */
export function formatChange(n: number | null | undefined, cfg: AnalyticsConfig): string {
  if (n === null || n === undefined) return "—";
  const v = cfg.kind === "percent" ? round1(n) : Math.round(n * 100) / 100;
  return `${v > 0 ? "+" : ""}${v} ${cfg.kind === "percent" ? "pp" : "pts"}`;
}

/** Display rounding for chart data: 1dp for percentages, 2dp for level points. */
export function roundFor(n: number, cfg: AnalyticsConfig): number {
  return cfg.kind === "percent" ? round1(n) : Math.round(n * 100) / 100;
}
