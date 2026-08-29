export type FunnelStage = {
  label: string;
  value: number | null;
  note?: string;
};

// Deliberately renders "Not tracked yet" rather than 0 for any stage with
// no real data source -- a 0 here would look identical to "we measured
// this and it was zero", which is a different, false claim. See stages
// without a `value` below (Demo Completed, School Onboarded): there is no
// field or table backing either of those today.
export function ConversionFunnel({ stages }: { stages: FunnelStage[] }) {
  return (
    <div className="panel p-4">
      <p className="mb-3 text-sm font-medium">Conversion funnel</p>
      <ol className="flex flex-col">
        {stages.map((stage, i) => {
          const prev = i > 0 ? stages[i - 1] : null;
          const rate =
            stage.value !== null && prev?.value != null && prev.value > 0
              ? ((stage.value / prev.value) * 100).toFixed(1)
              : null;
          return (
            <li key={stage.label} className="flex items-center gap-3 border-b border-border/60 py-2 last:border-0">
              <span className="w-44 shrink-0 text-sm">{stage.label}</span>
              <span className="text-lg font-semibold tabular-nums">
                {stage.value === null ? (
                  <span className="text-sm font-normal text-muted-foreground">Not tracked yet</span>
                ) : (
                  stage.value.toLocaleString()
                )}
              </span>
              {rate && <span className="text-xs text-muted-foreground">{rate}% of previous stage</span>}
              {stage.note && <span className="text-xs text-muted-foreground">{stage.note}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
