"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import type { MatrixRow, SchoolSummary } from "@/lib/academics/performance-analytics";
import { round1 } from "@/lib/academics/performance-analytics";

function Panel({ title, empty, children }: { title: string; empty?: boolean; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border p-3">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {empty ? <p className="text-xs text-muted-foreground">No data for the selected filters.</p> : <div className="h-60 w-full">{children}</div>}
    </section>
  );
}

const PALETTE = ["#2563eb", "#16a34a", "#ca8a04", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#ea580c", "#475569"];

function seriesKeys(rows: MatrixRow[]): string[] {
  return [...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => k !== "year")))];
}

function GroupedBars({ rows }: { rows: MatrixRow[] }) {
  const keys = seriesKeys(rows);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="year" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v, name) => [`${v}%`, String(name)]} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {keys.map((k, i) => (
          <Bar key={k} dataKey={k} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

const grid = <CartesianGrid strokeDasharray="3 3" opacity={0.3} />;
const pctTip = (v: unknown) => [`${v}%`, "Average"] as [string, string];

/** Charts for the whole-school analytics page. Pure rendering of a SchoolSummary, nothing computed here beyond rounding for display. */
export function SchoolAnalyticsCharts({ summary }: { summary: SchoolSummary }) {
  const years = summary.yearAverages.map((y) => ({ name: y.yearName, average: round1(y.average) }));
  const classes = summary.classAverages.map((c) => ({ name: c.label, average: round1(c.average) }));
  const subjects = summary.subjectAverages.map((s) => ({ name: s.label, average: round1(s.average) }));
  const terms = summary.termAverages.map((t) => ({ name: `Term ${t.termNumber}`, average: round1(t.average) }));
  const dist = summary.distribution.map((d) => ({ name: d.label, students: d.count }));

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title="School average by year" empty={years.length === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={years} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
            {grid}
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
            <Tooltip formatter={pctTip} />
            <Line type="monotone" dataKey="average" stroke="currentColor" strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>
      <Panel title="Term-by-term average" empty={terms.length === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={terms} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
            {grid}
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
            <Tooltip formatter={pctTip} />
            <Bar dataKey="average" fill="currentColor" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
      <Panel title="Class comparison" empty={classes.length === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={classes} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
            {grid}
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
            <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
            <Tooltip formatter={pctTip} />
            <Bar dataKey="average" fill="currentColor" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
      <Panel title="Subject averages" empty={subjects.length === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={subjects} layout="vertical" margin={{ top: 5, right: 16, left: 20, bottom: 5 }}>
            {grid}
            <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
            <Tooltip formatter={pctTip} />
            <Bar dataKey="average" fill="currentColor" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
      <Panel title="Classes across years" empty={summary.classByYear.length === 0}>
        <GroupedBars rows={summary.classByYear} />
      </Panel>
      <Panel title="Subjects across years" empty={summary.subjectByYear.length === 0}>
        <GroupedBars rows={summary.subjectByYear} />
      </Panel>
      {dist.length > 0 && (
        <Panel title="Students by performance category">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dist} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
              {grid}
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="students" fill="currentColor" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      )}
    </div>
  );
}
