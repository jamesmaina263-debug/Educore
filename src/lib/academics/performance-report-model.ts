import {
  formatChange,
  formatScore,
  roundFor,
  type AnalyticsConfig,
  type HistorySummary,
  type SchoolSummary,
  type SubjectProgression,
  type YearPoint,
} from "@/lib/academics/performance-analytics";

// Turns already-computed analytics into a plain, serialisable report description. No arithmetic beyond
// formatting happens here and no PDF library is imported, so the exact same numbers feed the on-screen
// view, the Excel export and the PDF (performance-report-pdf.ts only draws what it is given).

export interface ReportStat {
  label: string;
  value: string;
}
export interface ReportChart {
  kind: "line" | "bar";
  title: string;
  labels: string[];
  series: { name: string; values: (number | null)[] }[];
  min: number;
  max: number;
  unit: string;
}
export interface ReportTable {
  title: string;
  head: string[];
  rows: (string | number)[][];
}
export interface PerformanceReport {
  title: string;
  subtitle: string;
  stats: ReportStat[];
  charts: ReportChart[];
  tables: ReportTable[];
  notes: string[];
}

const TREND_LABEL: Record<string, string> = { improving: "Improving", declining: "Declining", stable: "Stable", insufficient_data: "Not enough years yet" };

export function studentReportModel(input: {
  studentName: string;
  admissionNumber: string | null;
  className: string | null;
  enrolledOn: string | null;
  cfg: AnalyticsConfig;
  years: YearPoint[];
  summary: HistorySummary;
  subjects: SubjectProgression[];
  attendance: { percentage: number; daysRecorded: number } | null;
  scaleNote: string;
}): PerformanceReport {
  const { cfg, years, summary, subjects } = input;
  return {
    title: `Academic history: ${input.studentName}`,
    subtitle: [input.admissionNumber, input.className, input.enrolledOn ? `Enrolled ${input.enrolledOn}` : null].filter(Boolean).join(" · "),
    stats: [
      { label: "Growth since enrolment", value: formatChange(summary.growthSinceEnrolment, cfg) },
      { label: "Historical average", value: formatScore(summary.historicalAverage, cfg) },
      { label: "Years tracked", value: String(summary.yearsTracked) },
      { label: "Current trend", value: TREND_LABEL[summary.trend] },
      { label: "Highest year", value: summary.highestYear ? `${summary.highestYear.yearName}: ${formatScore(summary.highestYear.average, cfg)}` : "—" },
      { label: "Lowest year", value: summary.lowestYear ? `${summary.lowestYear.yearName}: ${formatScore(summary.lowestYear.average, cfg)}` : "—" },
      { label: "Attendance", value: input.attendance ? `${Math.round(input.attendance.percentage * 10) / 10}% (${input.attendance.daysRecorded} days)` : "—" },
    ],
    charts: [
      {
        kind: "line",
        title: "Overall average by year",
        labels: years.map((y) => y.yearName),
        series: [{ name: "Average", values: years.map((y) => roundFor(y.average, cfg)) }],
        min: cfg.min,
        max: cfg.max,
        unit: cfg.unit.trim(),
      },
      ...(subjects.length > 0
        ? [
            {
              kind: "line" as const,
              title: "Subject progression",
              labels: years.map((y) => y.yearName),
              series: subjects.map((s) => ({
                name: s.subjectName,
                values: years.map((y) => {
                  const p = s.points.find((x) => x.yearId === y.yearId);
                  return p ? roundFor(p.average, cfg) : null;
                }),
              })),
              min: cfg.min,
              max: cfg.max,
              unit: cfg.unit.trim(),
            },
          ]
        : []),
    ],
    tables: [
      {
        title: "Year by year",
        head: ["Year", "Average", "Change", "Assessments", "Terms", "Complete"],
        rows: years.map((y) => [y.yearName, formatScore(y.average, cfg), formatChange(y.changeFromPrevious, cfg), y.assessments, y.termsCovered.join(", "), y.incomplete ? "No" : "Yes"]),
      },
      {
        title: "Subject progression",
        head: ["Subject", "Trend", "First to latest", ...years.map((y) => y.yearName)],
        rows: subjects.map((s) => [
          s.subjectName,
          TREND_LABEL[s.direction],
          formatChange(s.change, cfg),
          ...years.map((y) => {
            const p = s.points.find((x) => x.yearId === y.yearId);
            return p ? formatScore(p.average, cfg) : "—";
          }),
        ]),
      },
    ],
    notes: [input.scaleNote, "Years marked incomplete have results for fewer than three terms. Missing marks are left out of averages, never counted as zero.", "Support signal, not an official assessment."],
  };
}

export function schoolReportModel(input: {
  schoolName: string;
  cfg: AnalyticsConfig;
  summary: SchoolSummary;
  filterText: string;
  scaleNote: string;
}): PerformanceReport {
  const { cfg, summary: s } = input;
  const sub = s.weakestSubject && s.subjectAverages.length > 1;
  return {
    title: "Whole-school academic performance",
    subtitle: [input.schoolName, input.filterText].filter(Boolean).join(" · "),
    stats: [
      { label: "School average", value: formatScore(s.overallAverage, cfg) },
      { label: "Students assessed", value: String(s.studentsAssessed) },
      { label: "Improving", value: String(s.improving) },
      { label: "Declining", value: String(s.declining) },
      { label: "Consistent", value: String(s.consistent) },
      { label: "Not enough history", value: String(s.insufficientHistory) },
      { label: "Strongest class", value: s.bestClass ? `${s.bestClass.label} (${formatScore(s.bestClass.average, cfg)})` : "—" },
      { label: "Weakest class", value: s.weakestClass && s.classAverages.length > 1 ? `${s.weakestClass.label} (${formatScore(s.weakestClass.average, cfg)})` : "—" },
      { label: "Best subject", value: s.bestSubject ? `${s.bestSubject.label} (${formatScore(s.bestSubject.average, cfg)})` : "—" },
      { label: "Weakest subject", value: sub && s.weakestSubject ? `${s.weakestSubject.label} (${formatScore(s.weakestSubject.average, cfg)})` : "—" },
    ],
    charts: [
      { kind: "line", title: "School average by year", labels: s.yearAverages.map((y) => y.yearName), series: [{ name: "Average", values: s.yearAverages.map((y) => roundFor(y.average, cfg)) }], min: cfg.min, max: cfg.max, unit: cfg.unit.trim() },
      { kind: "bar", title: "Class comparison", labels: s.classAverages.map((c) => c.label), series: [{ name: "Average", values: s.classAverages.map((c) => roundFor(c.average, cfg)) }], min: cfg.min, max: cfg.max, unit: cfg.unit.trim() },
      { kind: "bar", title: "Subject averages", labels: s.subjectAverages.map((x) => x.label), series: [{ name: "Average", values: s.subjectAverages.map((x) => roundFor(x.average, cfg)) }], min: cfg.min, max: cfg.max, unit: cfg.unit.trim() },
      ...(s.distribution.length > 0
        ? [{ kind: "bar" as const, title: "Students by performance category", labels: s.distribution.map((d) => d.label), series: [{ name: "Students", values: s.distribution.map((d) => d.count) }], min: 0, max: Math.max(1, ...s.distribution.map((d) => d.count)), unit: "" }]
        : []),
    ],
    tables: [
      { title: "Classes", head: ["Class", "Average", "Assessments"], rows: s.classAverages.map((c) => [c.label, formatScore(c.average, cfg), c.assessments]) },
      {
        title: "Subjects",
        head: ["Subject", "Average", "Change", "Needs attention"],
        rows: s.subjectAverages.map((x) => [x.label, formatScore(x.average, cfg), formatChange(x.change, cfg), x.needsIntervention ? "Yes" : "No"]),
      },
      {
        title: "Years",
        head: ["Year", "Average", "Change", "Assessments", "Complete"],
        rows: s.yearAverages.map((y) => [y.yearName, formatScore(y.average, cfg), formatChange(y.changeFromPrevious, cfg), y.assessments, y.incomplete ? "No" : "Yes"]),
      },
    ],
    notes: [input.scaleNote, "Based on closed exams only. Missing marks are excluded, never counted as zero."],
  };
}
