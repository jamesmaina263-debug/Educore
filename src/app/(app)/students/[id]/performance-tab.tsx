"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import type { StudentPerformanceHistory } from "./performance-actions";
import type { TrendDirection } from "@/lib/academics/growth-trend";
import { round1 } from "@/lib/academics/performance-analytics";

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

const pp = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${round1(n)} pp`);
const pct = (n: number | null) => (n === null ? "—" : `${round1(n)}%`);

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Progress since enrolment (Academic Performance Analytics module). Read view over
 * getStudentPerformanceHistory; every number is computed in performance-analytics.ts, nothing is
 * calculated here. Years with fewer than three terms of results are labelled incomplete, never hidden.
 */
export function PerformanceTab({ history }: { history: StudentPerformanceHistory | { error: string } }) {
  const [subjectId, setSubjectId] = useState<string>("");
  const [yearId, setYearId] = useState<string>("");

  if ("error" in history) {
    return <p className="text-sm text-danger">Could not load performance history: {history.error}</p>;
  }
  const { years, summary, subjects, termsByYear, subjectsByYear } = history;
  if (years.length === 0) {
    return <p className="text-sm text-muted-foreground">No closed-exam results on file yet. The performance history builds automatically as exams are closed.</p>;
  }

  const lineData = years.map((y) => ({ year: y.yearName, average: round1(y.average), assessments: y.assessments, incomplete: y.incomplete }));
  const selectedSubject = subjects.find((s) => s.subjectId === subjectId) ?? subjects[0];
  const subjectData = (selectedSubject?.points ?? []).map((p) => ({ year: p.yearName, average: round1(p.average) }));
  const activeYear = years.find((y) => y.yearId === yearId) ?? years[years.length - 1];
  const termData = (termsByYear[activeYear.yearId] ?? []).map((t) => ({ term: `Term ${t.termNumber}`, average: round1(t.average) }));
  const yearSubjects = subjectsByYear[activeYear.yearId] ?? [];
  const best = yearSubjects[0];
  const worst = yearSubjects.length > 1 ? yearSubjects[yearSubjects.length - 1] : null;
  const anyIncomplete = years.some((y) => y.incomplete);

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Growth since enrolment" value={pp(summary.growthSinceEnrolment)} hint="Last year minus first year" />
        <Stat label="Historical average" value={pct(summary.historicalAverage)} />
        <Stat label="Years tracked" value={String(summary.yearsTracked)} />
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Current trend</p>
          <Badge variant={DIRECTION_VARIANT[summary.trend]}>{DIRECTION_LABEL[summary.trend]}</Badge>
        </div>
        <Stat label="Highest year" value={summary.highestYear ? `${summary.highestYear.yearName}: ${pct(summary.highestYear.average)}` : "—"} />
        <Stat label="Lowest year" value={summary.lowestYear ? `${summary.lowestYear.yearName}: ${pct(summary.lowestYear.average)}` : "—"} />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Overall average by year</h3>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lineData} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
              <Tooltip formatter={(v) => [`${v}%`, "Average"]} />
              <Line type="monotone" dataKey="average" stroke="currentColor" strokeWidth={2} dot={{ r: 4 }} />
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
                  <td className="py-1 pr-3">{pct(y.average)}</td>
                  <td className="py-1 pr-3">{pp(y.changeFromPrevious)}</td>
                  <td className="py-1 pr-3">{y.assessments}</td>
                  <td className="py-1">
                    {y.termsCovered.join(", ")} {y.incomplete && <Badge variant="outline">Incomplete</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {anyIncomplete && (
          <p className="text-xs text-muted-foreground">
            Years marked Incomplete have results for fewer than three terms. Missing marks are left out of averages, never counted as zero.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Terms and subjects within a year</h3>
          <select aria-label="Academic year" className="rounded-md border border-border bg-background px-2 py-1 text-sm" value={activeYear.yearId} onChange={(e) => setYearId(e.target.value)}>
            {years.map((y) => (
              <option key={y.yearId} value={y.yearId}>
                {y.yearName}
              </option>
            ))}
          </select>
        </div>
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={termData} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="term" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
              <Tooltip formatter={(v) => [`${v}%`, "Average"]} />
              <Bar dataKey="average" fill="currentColor" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {best && (
          <p className="text-sm text-muted-foreground">
            Highest subject: <span className="font-medium text-foreground">{best.subjectName} ({pct(best.average)})</span>
            {worst && (
              <>
                {" "}· Lowest subject: <span className="font-medium text-foreground">{worst.subjectName} ({pct(worst.average)})</span>
              </>
            )}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Subject progression since enrolment</h3>
          <select aria-label="Subject" className="rounded-md border border-border bg-background px-2 py-1 text-sm" value={selectedSubject?.subjectId ?? ""} onChange={(e) => setSubjectId(e.target.value)}>
            {subjects.map((s) => (
              <option key={s.subjectId} value={s.subjectId}>
                {s.subjectName}
              </option>
            ))}
          </select>
        </div>
        {selectedSubject && (
          <div className="flex items-center gap-2 text-sm">
            <Badge variant={DIRECTION_VARIANT[selectedSubject.direction]}>{DIRECTION_LABEL[selectedSubject.direction]}</Badge>
            <span className="text-muted-foreground">{pp(selectedSubject.change)} first to latest year</span>
          </div>
        )}
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={subjectData} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
              <Tooltip formatter={(v) => [`${v}%`, "Average"]} />
              <Line type="monotone" dataKey="average" stroke="currentColor" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Percentages use each paper&apos;s own maximum. Change is shown in percentage points. A trend moves from Stable only when the
        first-to-latest change is 5 points or more. This is a support signal, not an official assessment.
      </p>
    </div>
  );
}
