import { formatInstantNairobi } from "@/lib/sales/pipeline";
import { MODE_LABELS, needsOutcome, openDemos, type DemoMode, type DemoRow } from "@/lib/sales/demos";

// Presentational: the scheduled demos across all leads, soonest first. Past-due ones are flagged so an unrecorded
// outcome is not forgotten. Read-only; recording happens in each lead's detail.

export function UpcomingDemos({
  demos,
  leadNames,
  repNameById,
  now,
}: {
  demos: DemoRow[];
  leadNames: Map<string, string>;
  repNameById: Map<string, string>;
  now: Date;
}) {
  const open = openDemos(demos);
  const overdue = open.filter((d) => needsOutcome(d, now)).length;
  return (
    <section className="panel flex flex-col gap-2 p-4">
      <div>
        <h2 className="text-sm font-medium">Upcoming demos</h2>
        <p className="text-xs text-muted-foreground">
          Demos your team has booked, soonest first. Recorded by hand: nothing is sent and no calendar is involved.
          {overdue > 0 ? ` ${overdue} past demo${overdue === 1 ? " needs" : "s need"} an outcome.` : ""}
        </p>
      </div>
      {open.length === 0 ? (
        <p className="text-xs text-muted-foreground">No demos booked. Open a school below and use Book a demo.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {open.map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="tabular-nums">{formatInstantNairobi(d.scheduled_for, true)}</span>
              <span className="font-medium">{leadNames.get(d.lead_id) ?? "Unknown school"}</span>
              <span className="text-xs text-muted-foreground">
                {MODE_LABELS[d.mode as DemoMode] ?? d.mode}
                {d.host_id && repNameById.get(d.host_id) ? ` · ${repNameById.get(d.host_id)}` : ""}
              </span>
              {needsOutcome(d, now) && <span className="text-xs font-medium text-destructive">Record the outcome</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
