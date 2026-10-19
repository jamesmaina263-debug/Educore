import { createClient } from "@/lib/supabase/server";
import { isSmallSample } from "@/lib/growth/report";
import { funnelRows, parseTrialFunnel, type TrialFunnelRow } from "@/lib/growth/trial-funnel";

// "Trial funnel" panel of /admin/analytics: visits -> /signup -> trials, then what those trial schools have
// set up so far. One read-only call (admin_trial_funnel); nothing is estimated. If the call fails (for example
// right after a deploy) a short notice is shown instead of a zero, so a broken query never reads as "no trials".

function Rows({ rows }: { rows: TrialFunnelRow[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.label} className="flex items-baseline justify-between gap-3 text-sm">
          <span>
            {r.label}
            {r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}
          </span>
          <span className="tabular-nums">
            <span className="font-semibold">{r.value.toLocaleString()}</span>
            {r.ofPrevious && <span className="ml-2 text-xs text-muted-foreground">{r.ofPrevious}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export async function TrialFunnelPanel({ startIso, endIso }: { startIso: string; endIso: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_trial_funnel", { p_from: startIso, p_to: endIso });
  const funnel = error ? null : parseTrialFunnel(data);

  if (!funnel) {
    return (
      <div className="panel p-4">
        <p className="text-sm font-medium">Trial funnel</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This could not be loaded{error ? `: ${error.message}` : ""}. Nothing is estimated, so nothing is shown. If this
          appeared right after a deploy, refresh in a minute.
        </p>
      </div>
    );
  }

  const { journey, setup } = funnelRows(funnel);
  const cohort = funnel.activation.cohortSchools;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="panel flex flex-col gap-3 p-4">
        <div>
          <p className="text-sm font-medium">Trial funnel</p>
          <p className="text-xs text-muted-foreground">From our own visit counter and records. Percentages are the share of the row above.</p>
        </div>
        <Rows rows={journey} />
        {isSmallSample(funnel.trialsStarted) && (
          <p className="text-xs text-muted-foreground">Only {funnel.trialsStarted} trials: read the percentages as anecdotes, not a trend.</p>
        )}
      </div>
      <div className="panel flex flex-col gap-3 p-4">
        <div>
          <p className="text-sm font-medium">What trial schools have set up</p>
          <p className="text-xs text-muted-foreground">
            Where the {cohort.toLocaleString()} trial {cohort === 1 ? "school" : "schools"} that started in this period are now (demo and
            test schools excluded). Not a day-by-day record.
          </p>
        </div>
        {cohort === 0 ? <p className="text-xs text-muted-foreground">No trials started in this period.</p> : <Rows rows={setup} />}
        {isSmallSample(cohort) && (
          <p className="text-xs text-muted-foreground">Only {cohort} in this group: read the percentages as anecdotes, not a trend.</p>
        )}
      </div>
    </div>
  );
}
