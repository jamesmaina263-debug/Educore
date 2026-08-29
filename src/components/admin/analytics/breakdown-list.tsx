export function BreakdownList({
  title,
  rows,
  valueLabel = "Visitors",
}: {
  title: string;
  rows: { label: string; value: number }[];
  valueLabel?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="panel p-4">
      <p className="mb-3 text-sm font-medium">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data for this period.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center gap-2 text-sm">
              <span className="w-32 shrink-0 truncate text-muted-foreground" title={row.label}>
                {row.label}
              </span>
              <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-primary/70"
                  style={{ width: `${(row.value / max) * 100}%` }}
                />
              </span>
              <span className="w-12 shrink-0 text-right font-medium tabular-nums">{row.value}</span>
            </li>
          ))}
        </ul>
      )}
      <span className="sr-only">{valueLabel}</span>
    </div>
  );
}
