import Link from "next/link";
import type { PeriodKey } from "@/lib/analytics-date-range";

const OPTIONS: { key: "day" | "week" | "month"; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

// Preserves the current period/custom-range query params, only swapping
// `granularity` -- otherwise clicking a granularity tab would silently
// reset the user's selected date range back to the default.
export function GranularityTabs({
  active,
  period,
  from,
  to,
}: {
  active: "day" | "week" | "month";
  period: PeriodKey;
  from?: string;
  to?: string;
}) {
  const baseParams = new URLSearchParams({ period });
  if (period === "custom" && from && to) {
    baseParams.set("from", from);
    baseParams.set("to", to);
  }

  return (
    <div className="flex gap-1 rounded-md border border-border bg-muted/40 p-1 text-xs">
      {OPTIONS.map((opt) => {
        const params = new URLSearchParams(baseParams);
        params.set("granularity", opt.key);
        return (
          <Link
            key={opt.key}
            href={`/admin/analytics?${params.toString()}`}
            className={`rounded px-2 py-0.5 ${
              opt.key === active ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}
