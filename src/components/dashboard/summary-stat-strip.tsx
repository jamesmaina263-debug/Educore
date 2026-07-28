import { cn } from "@/lib/utils";

export interface SummaryStat {
  label: string;
  value: string;
  delta?: { value: string; direction: "up" | "down" | "flat" };
}

export function SummaryStatStrip({ stats }: { stats: SummaryStat[] }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-border rounded-md border border-border bg-surface sm:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="px-4 py-3">
          <div className="text-xs text-muted-foreground">{stat.label}</div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-lg font-semibold tabular-nums">{stat.value}</span>
            {stat.delta && (
              <span
                className={cn(
                  "text-xs font-medium",
                  stat.delta.direction === "up" && "text-success",
                  stat.delta.direction === "down" && "text-danger",
                  stat.delta.direction === "flat" && "text-muted-foreground",
                )}
              >
                {stat.delta.direction === "up" && "↑"}
                {stat.delta.direction === "down" && "↓"}
                {stat.delta.value}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
