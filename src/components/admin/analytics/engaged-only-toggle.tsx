import Link from "next/link";
import type { PeriodKey } from "@/lib/analytics-date-range";

// Preserves period/custom-range/granularity query params, only swapping
// `engagedOnly` -- same pattern as GranularityTabs, so switching this
// toggle never resets the visitor's selected date range or trend
// granularity.
export function EngagedOnlyToggle({
  active,
  period,
  from,
  to,
  granularity,
}: {
  active: boolean;
  period: PeriodKey;
  from?: string;
  to?: string;
  granularity?: string;
}) {
  const baseParams = new URLSearchParams({ period });
  if (period === "custom" && from && to) {
    baseParams.set("from", from);
    baseParams.set("to", to);
  }
  if (granularity) baseParams.set("granularity", granularity);

  const offParams = new URLSearchParams(baseParams);
  const onParams = new URLSearchParams(baseParams);
  onParams.set("engagedOnly", "1");

  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1 rounded-md border border-border bg-muted/40 p-1 text-xs">
        <Link
          href={`/admin/analytics?${offParams.toString()}`}
          className={`rounded px-2 py-0.5 ${
            !active ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          All sessions
        </Link>
        <Link
          href={`/admin/analytics?${onParams.toString()}`}
          className={`rounded px-2 py-0.5 ${
            active ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Engaged only
        </Link>
      </div>
      {active && (
        <span className="text-xs text-muted-foreground" title="Engaged: 10s+ active, 2+ pageviews, or a conversion">
          10s+ active, 2+ pageviews, or a conversion
        </span>
      )}
    </div>
  );
}
