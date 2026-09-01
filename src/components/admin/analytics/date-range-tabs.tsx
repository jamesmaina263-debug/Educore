import Link from "next/link";
import { PERIOD_OPTIONS, type PeriodKey } from "@/lib/analytics-date-range";

export function DateRangeTabs({
  active,
  basePath = "/admin/analytics",
}: {
  active: PeriodKey;
  /** Which page's period tabs these are -- defaults to the original analytics page so existing callers are unaffected. */
  basePath?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-md border border-border bg-muted/40 p-1 text-sm">
      {PERIOD_OPTIONS.map((opt) => (
        <Link
          key={opt.key}
          href={`${basePath}?period=${opt.key}`}
          className={`rounded px-2.5 py-1 ${
            opt.key === active
              ? "bg-background font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt.label}
        </Link>
      ))}
      <Link
        href={`${basePath}?period=custom`}
        className={`rounded px-2.5 py-1 ${
          active === "custom" ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Custom
      </Link>
    </div>
  );
}
