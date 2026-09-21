import type { ChannelPerformanceRow } from "@/lib/ga4";

// Sibling to BreakdownList, but two value columns (sessions + engagement
// rate) instead of one -- volume alone doesn't say whether a channel's
// traffic is worth the spend, which matters most once Google Ads is
// linked and channels start costing money.
export function ChannelPerformanceList({ rows }: { rows: ChannelPerformanceRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.sessions));
  return (
    <div className="panel p-4">
      <p className="mb-3 text-sm font-medium">Channel performance</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data for this period.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center gap-2 text-sm">
              <span className="w-28 shrink-0 truncate text-muted-foreground" title={row.label}>
                {row.label}
              </span>
              <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-primary/70"
                  style={{ width: `${(row.sessions / max) * 100}%` }}
                />
              </span>
              <span className="w-16 shrink-0 text-right font-medium tabular-nums">{row.sessions} sess.</span>
              <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {row.engagementRate.toFixed(0)}% eng.
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
