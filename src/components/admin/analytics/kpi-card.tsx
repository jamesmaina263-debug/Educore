export function KpiCard({
  label,
  value,
  sub,
  changePercent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  /** Percent change vs. the prior equivalent period. Omit if unknown/not applicable -- never render a fabricated trend. */
  changePercent?: number | null;
}) {
  return (
    <div className="panel p-4">
      <p className="label-eyebrow">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      {changePercent !== undefined && changePercent !== null && (
        <p className={`text-xs font-medium ${changePercent >= 0 ? "text-success" : "text-destructive"}`}>
          {changePercent >= 0 ? "+" : ""}
          {changePercent.toFixed(1)}% vs. prior period
        </p>
      )}
    </div>
  );
}
