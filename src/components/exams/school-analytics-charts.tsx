"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { roundFor, type AnalyticsConfig, type MatrixRow, type SchoolSummary } from "@/lib/academics/performance-analytics";

function Panel({ title, empty, children }: { title: string; empty?: boolean; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border p-3">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {empty ? <p className="text-xs text-muted-foreground">No data for the selected filters.</p> : <div className="h-60 w-full">{children}</div>}
    </section>
  );
}

const PALETTE = ["#2563eb", "#16a34a", "#ca8a04", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#ea580c", "#475569"];
const grid = <CartesianGrid strokeDasharray="3 3" opacity={0.3} />;

function seriesKeys(rows: MatrixRow[]): string[] {
  return [...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => k !== "year")))];
}

function GroupedBars({ rows, domain, tip }: { rows: MatrixRow[]; domain: [number, number]; tip: (v: unknown, name?: unknown) => [string, string] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
        {grid}
        <XAxis dataKey="year" tick={{ fontSize: 11 }} />
        <YAxis domain={domain} tick={{ fontSize: 11 }} />
        <Tooltip formatter={tip} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {seriesKeys(rows).map((k, i) => (
          <Bar key={k} dataKey={k} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Charts for the school analytics page. Pure rendering of a SchoolSummary: the axis range, unit and
 * rounding come from the scale config, so a CBC level chart runs 1 to N points and a percentage chart
 * 0 to 100, and the two are never drawn on the same axis.
 */
export function SchoolAnalyticsCharts({ summary, config }: { summary: SchoolSummary; config: AnalyticsConfig }) {
  const domain: [number, number] = [config.min, config.max];
  const unit = config.unit;
  const tip = (v: unknown, name?: unknown) => [`${v}${unit}`, name ? String(name) : "Average"] as [string, string];
  const r = (n: number) => roundFor(n, config);

  const years = summary.yearAverages.map((y) => ({ name: y.yearName, average: r(y.average) }));
  const classes = summary.classAverages.map((c) => ({ name: c.label, average: r(c.average) }));
  const subjects = summary.subjectAverages.map((s) => ({ name: s.label, average: r(s.average) }));
  const terms = summary.termAverages.map((t) => ({ name: `Term ${t.termNumber}`, average: r(t.average) }));
  const dist = summary.distribution.map((d) => ({ name: d.label, students: d.count }));

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title="School average by year" empty={years.length === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={years} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
            {grid}
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis domain={domain} tick={{ fontSize: 11 }} />
            <Tooltip formatter={tip} />
            <Line type="monotone" dataKey="average" stroke="#2563eb" strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>
      <Panel title="Term-by-term average" empty={terms.length === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={terms} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
            {grid}
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis domain={domain} tick={{ fontSize: 11 }} />
            <Tooltip formatter={tip} />
            <Bar dataKey="average" fill="#2563eb" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
      <Panel title="Class comparison" empty={classes.length === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={classes} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
            {grid}
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
            <YAxis domain={domain} tick={{ fontSize: 11 }} />
            <Tooltip formatter={tip} />
            <Bar dataKey="average" fill="#16a34a" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
      <Panel title="Subject averages" empty={subjects.length === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={subjects} layout="vertical" margin={{ top: 5, right: 16, left: 20, bottom: 5 }}>
            {grid}
            <XAxis type="number" domain={domain} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
            <Tooltip formatter={tip} />
            <Bar dataKey="average" fill="#ca8a04" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
      <Panel title="Classes across years" empty={summary.classByYear.length === 0}>
        <GroupedBars rows={summary.classByYear} domain={domain} tip={tip} />
      </Panel>
      <Panel title="Subjects across years" empty={summary.subjectByYear.length === 0}>
        <GroupedBars rows={summary.subjectByYear} domain={domain} tip={tip} />
      </Panel>
      {dist.length > 0 && (
        <Panel title="Students by performance category">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dist} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
              {grid}
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="students" fill="#7c3aed" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      )}
    </div>
  );
}
