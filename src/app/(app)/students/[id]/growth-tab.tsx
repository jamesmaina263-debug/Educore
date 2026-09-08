"use client";

import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Badge } from "@/components/ui/badge";
import type { StudentGrowthSummary, SubjectGrowth, IndicatorGrowth, SubStrandGrowth } from "./growth-actions";
import type { TrendDirection } from "@/lib/academics/growth-trend";

const DIRECTION_LABEL: Record<TrendDirection, string> = {
  improving: "Improving",
  declining: "Declining",
  stable: "Stable",
  insufficient_data: "Insufficient data",
};

const DIRECTION_VARIANT: Record<TrendDirection, "default" | "destructive" | "secondary" | "outline"> = {
  improving: "default",
  declining: "destructive",
  stable: "secondary",
  insufficient_data: "outline",
};

function TrendRow({ title, subtitle, trend }: { title: string; subtitle?: string; trend: SubjectGrowth["trend"] }) {
  const [expanded, setExpanded] = useState(false);
  const chartData = trend.points.map((p) => ({ label: p.label, value: p.value }));

  return (
    <div className="rounded-md border border-border p-3">
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setExpanded((v) => !v)}>
        <div>
          <p className="text-sm font-medium">{title}</p>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {trend.change !== null && (
            <span className="text-xs text-muted-foreground">
              {trend.change > 0 ? "+" : ""}
              {trend.change.toFixed(1)}
            </span>
          )}
          <Badge variant={DIRECTION_VARIANT[trend.direction]}>{DIRECTION_LABEL[trend.direction]}</Badge>
        </div>
      </button>
      {expanded && chartData.length > 0 && (
        <div className="mt-3 h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="currentColor" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {expanded && chartData.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">Not enough recorded history yet for this to chart.</p>
      )}
    </div>
  );
}

/**
 * Growth analysis (Performance Appraisal Engine directive, Phase 12 / Step
 * 8). Purely a read view over data already computed by getStudentGrowth --
 * see growth-actions.ts for how each series is built and growth-trend.ts
 * for the (unit-tested) classification itself. No new writes happen here.
 */
export function GrowthTab({ summary }: { summary: StudentGrowthSummary | { error: string } }) {
  if ("error" in summary) {
    return <p className="text-sm text-danger">Could not load growth data: {summary.error}</p>;
  }

  const { subjects, coreCompetencies, subStrandCompetencies } = summary;
  const hasAnything = subjects.length > 0 || coreCompetencies.length > 0 || subStrandCompetencies.length > 0;

  if (!hasAnything) {
    return <p className="text-sm text-muted-foreground">No recorded marks or ratings yet for this learner -- growth trends will appear here once at least two terms of results are on file.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {subjects.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Subject performance</h3>
          {subjects.map((s: SubjectGrowth) => (
            <TrendRow key={s.subjectId} title={s.subjectName} trend={s.trend} />
          ))}
        </section>
      )}

      {subStrandCompetencies.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">CBC competency (per sub-strand)</h3>
          {subStrandCompetencies.map((c: SubStrandGrowth) => (
            <TrendRow key={c.subStrandId} title={c.subStrandName} subtitle={c.subjectName} trend={c.trend} />
          ))}
        </section>
      )}

      {coreCompetencies.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Core competencies, values &amp; PCI</h3>
          {coreCompetencies.map((c: IndicatorGrowth) => (
            <TrendRow key={c.indicatorId} title={c.indicatorName} subtitle={c.indicatorType.replace(/_/g, " ")} trend={c.trend} />
          ))}
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        Trends compare the earliest and most recent recorded result on file; a change of less than 5 points either way is shown as
        Stable. This is a performance-support signal, not an official assessment or diagnosis.
      </p>
    </div>
  );
}
