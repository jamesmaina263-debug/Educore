import type { ReactNode } from "react";
import { CHECKPOINT_DAYS, type TrialFollowup, type TrialRow } from "@/lib/growth/trial-followup";

// Presentational only: takes the output of buildTrialFollowup and renders it. No data access, no actions.
// Everything shown is a suggestion for a person; nothing on this page sends a message or changes a trial.

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" });
}

function lastActive(r: TrialRow): string {
  if (!r.lastActiveAt) return "None recorded";
  if (r.inactiveDays === null) return fmtDate(r.lastActiveAt);
  return r.inactiveDays === 0 ? "Today" : `${r.inactiveDays} day${r.inactiveDays === 1 ? "" : "s"} ago`;
}

function Owner({ owner }: { owner: TrialRow["owner"] }) {
  if (!owner || (!owner.name && !owner.email)) return <span className="text-muted-foreground">No owner on file</span>;
  return (
    <div className="flex flex-col">
      {owner.name && <span>{owner.name}</span>}
      {owner.email && <span className="text-xs text-muted-foreground">{owner.email}</span>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="panel flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

export function TrialFollowupView({ data }: { data: TrialFollowup }) {
  const { summary } = data;
  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-wrap gap-8 p-4">
        <Stat label="Trials running" value={summary.running} />
        <Stat label="Need a check-in" value={summary.needsAttention} />
        <Stat label="Ending within 7 days" value={summary.endingWithin7Days} />
        <Stat label="Ended in the last 14 days, not converted" value={summary.recentlyExpired} />
      </div>

      <Panel
        title="Needs a check-in"
        note="Most urgent first. The suggested step is a starting point for a person to decide; nothing is sent from here."
      >
        {data.needsAttention.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {summary.running === 0
              ? "No trials are running right now."
              : "No running trial needs a check-in today. Everything is on track."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead>
                <tr>
                  <th className="text-left">School</th>
                  <th className="text-left">Trial</th>
                  <th className="text-left">Last active</th>
                  <th className="text-right">Staff</th>
                  <th className="text-left">Owner</th>
                  <th className="text-left">Why, and a suggested step</th>
                </tr>
              </thead>
              <tbody>
                {data.needsAttention.map((r) => (
                  <tr key={r.schoolId} className="align-top">
                    <td className="font-medium">{r.name}</td>
                    <td>
                      Day {r.trialDay} of {r.totalDays}
                      <div className="text-xs text-muted-foreground">
                        {r.daysLeft <= 0 ? "Ends today / ended" : `${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} left`} (
                        {fmtDate(r.trialEndsAt)})
                      </div>
                    </td>
                    <td>{lastActive(r)}</td>
                    <td className="text-right tabular-nums">{r.staffCount}</td>
                    <td>
                      <Owner owner={r.owner} />
                    </td>
                    <td>
                      <ul className="flex flex-col gap-0.5">
                        {r.reasonTexts.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                      {r.suggestion && <p className="mt-1 text-xs text-muted-foreground">{r.suggestion}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="On track" note="Running trials with nothing flagged today.">
        {data.onTrack.length === 0 ? (
          <p className="text-xs text-muted-foreground">None.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead>
                <tr>
                  <th className="text-left">School</th>
                  <th className="text-left">Trial</th>
                  <th className="text-left">Last active</th>
                  <th className="text-right">Staff</th>
                  <th className="text-left">Next suggested check-in</th>
                </tr>
              </thead>
              <tbody>
                {data.onTrack.map((r) => (
                  <tr key={r.schoolId}>
                    <td className="font-medium">{r.name}</td>
                    <td>
                      Day {r.trialDay} of {r.totalDays} · {r.daysLeft} day{r.daysLeft === 1 ? "" : "s"} left
                    </td>
                    <td>{lastActive(r)}</td>
                    <td className="text-right tabular-nums">{r.staffCount}</td>
                    <td>{r.nextCheckpoint ? `Day ${r.nextCheckpoint}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Trial ended recently, not converted"
        note="Suspended schools whose trial ended in the last 14 days: the best moment for a personal win-back conversation."
      >
        {data.recentlyExpired.length === 0 ? (
          <p className="text-xs text-muted-foreground">None.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead>
                <tr>
                  <th className="text-left">School</th>
                  <th className="text-left">Trial ended</th>
                  <th className="text-left">Last active</th>
                  <th className="text-left">Owner</th>
                </tr>
              </thead>
              <tbody>
                {data.recentlyExpired.map((r) => (
                  <tr key={r.schoolId} className="align-top">
                    <td className="font-medium">{r.name}</td>
                    <td>
                      {fmtDate(r.trialEndsAt)}
                      <div className="text-xs text-muted-foreground">
                        {Math.abs(r.daysLeft)} day{Math.abs(r.daysLeft) === 1 ? "" : "s"} ago
                      </div>
                    </td>
                    <td>{lastActive(r)}</td>
                    <td>
                      <Owner owner={r.owner} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-xs text-muted-foreground">
        School-level signals only: trial dates, last sign-in or activity, and the number of staff accounts. No learner data is
        read. Suggested check-in days ({CHECKPOINT_DAYS.join(", ")}) and the &ldquo;3 days&rdquo; thresholds are defaults, not rules.
        Demo and QA schools are left out. Nothing is sent from this page and no subscription is changed.
      </p>
    </div>
  );
}
