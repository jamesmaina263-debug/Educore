"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TimeseriesPoint } from "@/lib/plausible";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatTick(value: string, granularity: "day" | "week" | "month"): string {
  // `value` is always an ISO8601 date (YYYY-MM-DD) regardless of
  // granularity -- Plausible's time:week/time:month dimensions return the
  // bucket's start date, not a pre-formatted label.
  if (granularity === "month") {
    const monthIndex = Number(value.slice(5, 7)) - 1;
    return MONTH_LABELS[monthIndex] ?? value.slice(5, 7);
  }
  // day and week both read fine as "MM-DD" (week shows the week's start date)
  return value.slice(5);
}

export function TrafficTrendChart({
  data,
  granularity = "day",
}: {
  data: TimeseriesPoint[];
  granularity?: "day" | "week" | "month";
}) {
  return (
    <div className="panel p-4">
      {data.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data for this period.</p>
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: string) => formatTick(v, granularity)}
                axisLine={false}
                tickLine={false}
              />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Line type="monotone" dataKey="visitors" name="Visitors" stroke="var(--color-primary)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="pageviews" name="Pageviews" stroke="var(--color-muted-foreground)" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
