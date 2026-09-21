"use client";

import { Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { KeyEventSeriesPoint } from "@/lib/ga4";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Same label shapes getKeyEventsTimeseries() emits via formatPeriodLabel()
// in src/lib/ga4.ts -- see traffic-trend-chart.tsx's formatTick for the
// week/month caveat (best-effort labels, not resolved calendar dates).
function formatTick(value: string, granularity: "day" | "week" | "month"): string {
  if (granularity === "month") {
    const monthIndex = Number(value.slice(5, 7)) - 1;
    return MONTH_LABELS[monthIndex] ?? value.slice(5, 7);
  }
  return value.slice(5);
}

const LINE_COLORS = ["var(--color-primary)", "#16a34a", "var(--color-muted-foreground)"];

export function KeyEventsChart({
  data,
  eventNames,
  granularity = "day",
}: {
  data: KeyEventSeriesPoint[];
  eventNames: string[];
  granularity?: "day" | "week" | "month";
}) {
  const chartData: Array<{ date: string } & Record<string, number | string>> = data.map((point) => ({
    date: point.date,
    ...Object.fromEntries(eventNames.map((name) => [name, point.counts[name] ?? 0])),
  }));
  const hasAnyData = chartData.some((point) => eventNames.some((name) => Number(point[name] ?? 0) > 0));

  return (
    <div className="panel p-4">
      <p className="mb-3 text-sm font-medium">Key events over time</p>
      {!hasAnyData ? (
        <p className="text-xs text-muted-foreground">
          No {eventNames.join(" or ")} events in this period yet. Events only show up once GA4 has received
          them — Preview/testing traffic can take a few hours to appear.
        </p>
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: string) => formatTick(v, granularity)}
                axisLine={false}
                tickLine={false}
              />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {eventNames.map((name, i) => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  name={name}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
