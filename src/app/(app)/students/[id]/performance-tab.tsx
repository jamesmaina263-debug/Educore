"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { TableExportMenu } from "@/components/shared/table-export-menu";
import { PerformanceReportButton, type ReportSchool } from "@/components/exams/performance-report-button";
import type { StudentPerformanceData } from "./performance-actions";
import type { TrendDirection } from "@/lib/academics/growth-trend";
import {
  buildSubjectProgression,
  buildTermAverages,
  buildYearlySeries,
  configFor,
  formatChange,
  formatScore,
  levelBands,
  normaliseMarks,
  roundFor,
  summarizeHistory,
  type GradeBand,
  type ScoreKind,
} from "@/lib/academics/performance-analytics";
import { studentReportModel } from "@/lib/academics/performance-report-model";

const DIRECTION_LABEL: Record<TrendDirection, string> = {
  improving: "Improving",
  declining: "Declining",
  stable: "Stable",
  insufficient_data: "Not enough years yet",
};
const DIRECTION_VARIANT: Record<TrendDirection, "default" | "destructive" | "secondary" | "outline"> = {
  improving: "default",
  declining: "destructive",
  stable: "secondary",
  insufficient_data: "outline",
};
const grid = <CartesianGrid strokeDasharray="3 3" opacity={0.3} />;
const select = "rounded-md border border-border bg-background px-2 py-1 text-sm";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function bandLabel(avg: number | null, bands: GradeBand[]): string | null {
  if (avg === null) return null;
  const v = Math.round(avg * 100) / 100;
  return bands.find((b) => v >= b.min && v <= b.max)?.label ?? null;
}

/**
 * Progress since enrolment (Academic Performance Analytics module). Everything is scored, filtered and
 * summarised by performance-analytics.ts; this component only chooses what to show. Percentages and CBC
 * levels are never averaged together: when a learner has both, a switch picks the model. Years with
 * fewer than three terms of results are labelled incomplete, never hidden or compared as if whole.
 */
export function PerformanceTab({
  data,
  studentName,
  admissionNumber,
  className,
  enrolledOn,
  school,
}: {
  data: StudentPerformanceData | { error: string };
  studentName: string;
  admissionNumber: string | null;
  className: string | null;
  enrolledOn: string | null;
  school: ReportSchool;
}) {
  const [kindPick, setKindPick] = useState<ScoreKind | "">("");
  const [yearId, setYearId] = useState("");
  const [classId, setClassId] = useState("");
  const [term, setTerm] = useState("");
  const [subjectId, setSubjectId] = useState("");

  const all = useMemo(() => ("error" in data ? [] : normaliseMarks(data.marks)), [data]);
  const kinds = (["percent", "level"] as ScoreKind[]).filter((k) => all.some((m) => m.kind === k));
  const kind: ScoreKind = kindPick && kinds.includes(kindPick) ? kindPick : (kinds.sort((a, b) => all.filter((m) => m.kind === b).length - all.filter((m) => m.kind === a).length)[0] ?? "percent");

  const ofKind = useMemo(() => all.filter((m) => m.kind === kind), [all, kind]);
  const cfg = configFor(kind, Math.max(0, ...ofKind.map((m) => m.levelCount ?? 0)) || 4);
  const classes = [...new Map(ofKind.map((m) => [m.classId, m.classLabel])).entries()];
  const subjectsAll = [...new Map(ofKind.map((m) => [m.subjectId, m.subjectName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const filtered = useMemo(
    () => ofKind.filter((m) => (!classId || m.classId === classId) && (!term || m.termNumber === Number(term)) && (!subjectId || m.subjectId === subjectId)),
    [ofKind, classId, term, subjectId],
  );

  if ("error" in data) return <p className="text-sm text-danger">Could not load performance history: {data.error}</p>;

  const years = buildYearlySeries(filtered);
  const summary = summarizeHistory(filtered, years, cfg);
  const subjects = buildSubjectProgression(filtered, 3, cfg.stable);
  const activeYear = years.find((y) => y.yearId === yearId) ?? years[years.length - 1];
  const inYear = activeYear ? filtered.filter((m) => m.yearId === activeYear.yearId) : [];
  const termData = buildTermAverages(inYear).map((t) => ({ term: `Term ${t.termNumber}`, average: roundFor(t.average, cfg) }));
  const yearSubjects = buildSubjectProgression(inYear, 3, cfg.stable)
    .map((s) => ({ name: s.subjectName, average: s.points[0]?.average ?? 0 }))
    .sort((a, b) => b.average - a.average);
  const best = yearSubjects[0];
  const worst = yearSubjects.length > 1 ? yearSubjects[yearSubjects.length - 1] : null;
  const selectedSubject = subjects.find((s) => s.subjectId === subjectId) ?? subjects[0];
  const bands = kind === "level" ? levelBands(ofKind) : data.gradeBands;
  const overallGrade = bandLabel(summary.historicalAverage, bands);
  const yearGrade = bandLabel(activeYear?.average ?? null, bands);
  const anyIncomplete = years.some((y) => y.incomplete);
  const unit = cfg.kind === "percent" ? "%" : " pts";
  const tip = (v: unknown) => [`${v}${unit}`, "Average"] as [string, string];
  const scaleNote =
    kind === "level"
      ? "CBC levels are scored in level points: the best level scores the number of levels and the lowest scores 1 (A=4 … D=1 on a four-level scale)."
      : "Marks are converted to a percentage of each paper's own maximum. Change is in percentage points.";

  if (ofKind.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No closed-exam results on file yet. The performance history builds automatically as exams are closed.
        {data.skipped > 0 && ` ${data.skipped} result(s) exist but cannot be placed in a year for your account.`}
      </p>
    );
  }

  const report = studentReportModel({ studentName, admissionNumber, className, enrolledOn, cfg, years, summary, subjects, attendance: data.attendance, scaleNote });
  const markRows = inYear
    .map((m) => ({
      Year: m.yearName,
      Term: `Term ${m.termNumber}`,
      Exam: m.examName ?? "",
      Subject: m.subjectName,
      Result: m.kind === "level" ? (m.levelLabel ?? "") : `${m.rawScore}/${m.maxScore}`,
      [cfg.kind === "percent" ? "Percentage" : "Level points"]: roundFor(m.score, cfg),
    }))
    .sort((a, b) => a.Term.localeCompare(b.Term) || a.Subject.localeCompare(b.Subject));

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {data.photoUrl ? <img src={data.photoUrl} alt={`${studentName}`} className="size-14 rounded-full border border-border object-cover" /> : <div className="flex size-14 items-center justify-center rounded-full border border-border text-lg font-semibold text-muted-foreground">{studentName[0]}</div>}
          <div className="text-sm">
            <p className="font-semibold">{studentName}</p>
            <p className="text-xs text-muted-foreground">
              {[admissionNumber, className, enrolledOn ? `Enrolled ${enrolledOn}` : null, activeYear ? `Latest year ${activeYear.yearName}` : null].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <PerformanceReportButton report={report} school={school} fileName={`${studentName}-academic-history`} label="PDF report" />
          <TableExportMenu
            label="Export history"
            size="sm"
            filenameStub={`${studentName}-academic-history`}
            title={`Academic history: ${studentName}`}
            subtitle={`${school.name}${admissionNumber ? ` · ${admissionNumber}` : ""}`}
            rows={years.map((y) => ({
              Year: y.yearName,
              Average: roundFor(y.average, cfg),
              Change: y.changeFromPrevious === null ? "" : roundFor(y.changeFromPrevious, cfg),
              Assessments: y.assessments,
              Terms: y.termsCovered.join(", "),
              Complete: y.incomplete ? "No" : "Yes",
            }))}
          />
          <TableExportMenu
            label="Export subjects"
            size="sm"
            filenameStub={`${studentName}-subject-progression`}
            title={`Subject progression: ${studentName}`}
            subtitle={school.name}
            rows={subjects.flatMap((sub) => sub.points.map((p) => ({ Subject: sub.subjectName, Year: p.yearName, Average: roundFor(p.average, cfg), Change: p.changeFromPrevious === null ? "" : roundFor(p.changeFromPrevious, cfg) })))}
          />
        </div>
      </section>

      <section className="flex flex-wrap items-end gap-3">
        {kinds.length > 1 && (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Assessment model
            <select aria-label="Assessment model" className={select} value={kind} onChange={(e) => { setKindPick(e.target.value as ScoreKind); setSubjectId(""); }}>
              {kinds.map((k) => <option key={k} value={k}>{k === "level" ? "CBC levels" : "Percentage marks"}</option>)}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Class
          <select aria-label="Class" className={select} value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">All classes</option>
            {classes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Term
          <select aria-label="Term" className={select} value={term} onChange={(e) => setTerm(e.target.value)}>
            <option value="">All terms</option>
            {[1, 2, 3].map((t) => <option key={t} value={t}>Term {t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Subject
          <select aria-label="Subject filter" className={select} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">All subjects</option>
            {subjectsAll.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
      </section>

      {years.length === 0 ? (
        <p className="text-sm text-muted-foreground">No results match these filters.</p>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Overall average" value={formatScore(summary.historicalAverage, cfg)} hint={overallGrade ?? undefined} />
            <Stat label={`${activeYear.yearName} average`} value={formatScore(activeYear.average, cfg)} hint={yearGrade ?? undefined} />
            <Stat label="Growth since enrolment" value={formatChange(summary.growthSinceEnrolment, cfg)} hint="Last year minus first year" />
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">Current trend</p>
              <Badge variant={DIRECTION_VARIANT[summary.trend]}>{DIRECTION_LABEL[summary.trend]}</Badge>
            </div>
            <Stat label="Years tracked" value={String(summary.yearsTracked)} />
            <Stat label="Highest year" value={summary.highestYear ? `${summary.highestYear.yearName}: ${formatScore(summary.highestYear.average, cfg)}` : "—"} />
            <Stat label="Lowest year" value={summary.lowestYear ? `${summary.lowestYear.yearName}: ${formatScore(summary.lowestYear.average, cfg)}` : "—"} />
            <Stat
              label="Attendance"
              value={data.attendance ? `${Math.round(data.attendance.percentage * 10) / 10}%` : "—"}
              hint={data.attendance ? `${data.attendance.daysRecorded} days recorded` : "No attendance on file"}
            />
            {data.position && (
              <Stat
                label="Class position"
                value={data.position.rankInClass !== null ? `${data.position.rankInClass}${data.position.classSize ? ` of ${data.position.classSize}` : ""}` : "—"}
                hint={`${data.position.examName}${data.position.rankInStream !== null ? ` · stream ${data.position.rankInStream}` : ""}`}
              />
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Overall average by year</h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={years.map((y) => ({ year: y.yearName, average: roundFor(y.average, cfg) }))} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
                  {grid}
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis domain={[cfg.min, cfg.max]} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={tip} />
                  <Line type="monotone" dataKey="average" stroke="#2563eb" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-3">Year</th>
                    <th className="py-1 pr-3">Average</th>
                    <th className="py-1 pr-3">Change</th>
                    <th className="py-1 pr-3">Assessments</th>
                    <th className="py-1">Terms</th>
                  </tr>
                </thead>
                <tbody>
                  {years.map((y) => (
                    <tr key={y.yearId} className="border-t border-border">
                      <td className="py-1 pr-3">{y.yearName}</td>
                      <td className="py-1 pr-3">{formatScore(y.average, cfg)}</td>
                      <td className="py-1 pr-3">{formatChange(y.changeFromPrevious, cfg)}</td>
                      <td className="py-1 pr-3">{y.assessments}</td>
                      <td className="py-1">{y.termsCovered.join(", ")} {y.incomplete && <Badge variant="outline">Incomplete</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {anyIncomplete && <p className="text-xs text-muted-foreground">Years marked Incomplete have results for fewer than three terms. Missing marks are left out of averages, never counted as zero.</p>}
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Terms and subjects within a year</h3>
              <select aria-label="Academic year" className={select} value={activeYear.yearId} onChange={(e) => setYearId(e.target.value)}>
                {years.map((y) => <option key={y.yearId} value={y.yearId}>{y.yearName}</option>)}
              </select>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={termData} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
                    {grid}
                    <XAxis dataKey="term" tick={{ fontSize: 11 }} />
                    <YAxis domain={[cfg.min, cfg.max]} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={tip} />
                    <Bar dataKey="average" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={yearSubjects.map((s) => ({ name: s.name, average: roundFor(s.average, cfg) }))} layout="vertical" margin={{ top: 5, right: 16, left: 20, bottom: 5 }}>
                    {grid}
                    <XAxis type="number" domain={[cfg.min, cfg.max]} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={tip} />
                    <Bar dataKey="average" fill="#16a34a" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            {best && (
              <p className="text-sm text-muted-foreground">
                Highest subject: <span className="font-medium text-foreground">{best.name} ({formatScore(best.average, cfg)})</span>
                {worst && <> · Lowest subject: <span className="font-medium text-foreground">{worst.name} ({formatScore(worst.average, cfg)})</span></>}
              </p>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Subject progression since enrolment</h3>
              <select aria-label="Subject" className={select} value={selectedSubject?.subjectId ?? ""} onChange={(e) => setSubjectId(e.target.value)}>
                {subjects.map((s) => <option key={s.subjectId} value={s.subjectId}>{s.subjectName}</option>)}
              </select>
            </div>
            {selectedSubject && (
              <div className="flex items-center gap-2 text-sm">
                <Badge variant={DIRECTION_VARIANT[selectedSubject.direction]}>{DIRECTION_LABEL[selectedSubject.direction]}</Badge>
                <span className="text-muted-foreground">{formatChange(selectedSubject.change, cfg)} first to latest year</span>
              </div>
            )}
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={(selectedSubject?.points ?? []).map((p) => ({ year: p.yearName, average: roundFor(p.average, cfg) }))} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
                  {grid}
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis domain={[cfg.min, cfg.max]} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={tip} />
                  <Line type="monotone" dataKey="average" stroke="#16a34a" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Results in {activeYear.yearName}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-3">Term</th>
                    <th className="py-1 pr-3">Exam</th>
                    <th className="py-1 pr-3">Subject</th>
                    <th className="py-1 pr-3">Result</th>
                    <th className="py-1">{cfg.kind === "percent" ? "Percentage" : "Points"}</th>
                  </tr>
                </thead>
                <tbody>
                  {markRows.slice(0, 200).map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1 pr-3">{r.Term}</td>
                      <td className="py-1 pr-3">{r.Exam}</td>
                      <td className="py-1 pr-3">{r.Subject}</td>
                      <td className="py-1 pr-3">{r.Result}</td>
                      <td className="py-1">{(r as Record<string, string | number>)[cfg.kind === "percent" ? "Percentage" : "Level points"]}{unit.trim()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {markRows.length > 200 && <p className="mt-1 text-xs text-muted-foreground">Showing 200 of {markRows.length} results.</p>}
            </div>
          </section>
        </>
      )}

      {data.skipped > 0 && <p className="text-xs text-muted-foreground">{data.skipped} result(s) cannot be placed in a year or scale for your account and are left out.</p>}
      <p className="text-xs text-muted-foreground">
        {scaleNote} A trend reads Stable until the first-to-latest change is larger than {cfg.stable}{cfg.kind === "percent" ? " percentage points" : " points"}. This is a support signal, not an official assessment.
      </p>
    </div>
  );
}
