"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TimeseriesPoint } from "@/lib/plausible";

export function TrafficTrendChart({ data }: { data: TimeseriesPoint[] }) {
  return (
    <div className="panel p-4">
      <p className="mb-3 text-sm font-medium">Traffic trend</p>
      {data.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data for this period.</p>
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: string) => v.slice(5)}
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
