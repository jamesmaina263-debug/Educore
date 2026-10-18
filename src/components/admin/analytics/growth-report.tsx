import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SOURCES, STAGES } from "@/lib/sales/pipeline";
import {
  NOT_TRACKED_YET,
  aiActionLabel,
  isSmallSample,
  parseGrowthReport,
  ratePct,
  type GrowthReport as GrowthReportData,
} from "@/lib/growth/report";

// "Pipeline and conversion" section of /admin/analytics. One read-only call (admin_growth_report) returns
// every figure; nothing here is estimated, and anything with no real data source says "Not tracked yet"
// rather than 0. The date range is the one the rest of the page already uses (Kenya-time days).

function sourceLabel(value: string): string {
  if (value === "unspecified") return "Not recorded";
  return SOURCES.find((s) => s.value === value)?.label ?? value;
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-lg font-semibold tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div>
        <p className="text-sm font-medium">{title}</p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

function SmallSampleNote({ n }: { n: number }) {
  return isSmallSample(n) ? (
    <p className="text-xs text-muted-foreground">Only {n} in this group: read the percentages as anecdotes, not a trend.</p>
  ) : null;
}

export async function GrowthReport({ startIso, endIso }: { startIso: string; endIso: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_growth_report", { p_from: startIso, p_to: endIso });
  const report: GrowthReportData | null = error ? null : parseGrowthReport(data);

  if (!report) {
    return (
      <div className="panel p-4">
        <p className="text-sm font-medium">Pipeline and conversion</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This report could not be loaded{error ? `: ${error.message}` : ""}. Nothing below is estimated, so nothing is shown.
          If this appeared right after a deploy, the database update may still be applying: refresh in a minute.
        </p>
      </div>
    );
  }

  const d = report.demoRequests;
  const notInPipeline = Math.max(0, d.total - d.inPipeline);
  const c = report.leadCohort;
  const p = report.pipelineNow;
  const t = report.trials;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="growth-report-title">
      <div>
        <h2 id="growth-report-title" className="text-sm font-semibold text-muted-foreground">
          Pipeline and conversion
        </h2>
        <p className="text-xs text-muted-foreground">
          Measured from EduCore&apos;s own records for {report.from} to {report.to} (Kenya time). Panels marked
          &ldquo;today&rdquo; are a snapshot, not limited to this period.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Website demo requests to pipeline" note="Requests received in this period.">
          <div className="flex flex-wrap gap-6">
            <Stat label="Demo requests" value={d.total} />
            <Stat label="In the sales pipeline" value={d.inPipeline} hint={ratePct(d.inPipeline, d.total) ?? undefined} />
            <Stat label="Not in the pipeline yet" value={notInPipeline} />
          </div>
          {notInPipeline > 0 && (
            <p className="text-xs text-muted-foreground">
              Open{" "}
              <Link href="/admin/demo-requests" className="text-primary underline underline-offset-2">
                Demo requests
              </Link>{" "}
              and press &ldquo;Add to sales pipeline&rdquo; so each one gets a follow-up. Requests that arrived before that
              button existed were never linked, so older periods will read low.
            </p>
          )}
        </Panel>

        <Panel title="Leads created, by source" note="Leads added to the sales pipeline in this period.">
          {report.leadsCreated.bySource.length === 0 ? (
            <Empty>No leads were created in this period.</Empty>
          ) : (
            <table className="table-dense w-full">
              <tbody>
                {report.leadsCreated.bySource.map((s) => (
                  <tr key={s.label}>
                    <td>{sourceLabel(s.label)}</td>
                    <td className="text-right tabular-nums">{s.n.toLocaleString()}</td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td>Total</td>
                  <td className="text-right tabular-nums">{report.leadsCreated.total.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Pipeline today" note="Snapshot of every lead right now, whatever its age.">
          <div className="flex flex-wrap gap-6">
            <Stat label="Open leads" value={p.open} />
            <Stat label="Follow-ups overdue" value={p.overdueFollowups} />
            <Stat label="Due today" value={p.dueToday} />
            <Stat label="Open, no follow-up set" value={p.noFollowup} />
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {STAGES.map((s) => (
              <li key={s.value} className="flex items-baseline gap-1.5">
                <span className="font-semibold tabular-nums">{(p.byStage[s.value] ?? 0).toLocaleString()}</span>
                <span className="text-muted-foreground">{s.label}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            <Link href="/admin/sales-pipeline" className="text-primary underline underline-offset-2">
              Open the sales pipeline
            </Link>
          </p>
        </Panel>

        <Panel
          title="Leads created in this period: where they are now"
          note="Their current stage, not a history: a lead that reached a demo and was then lost shows only under Lost."
        >
          {c.created === 0 ? (
            <Empty>No leads were created in this period.</Empty>
          ) : (
            <table className="table-dense w-full">
              <tbody>
                {(
                  [
                    ["Created", c.created],
                    ["At or past Demo booked", c.atOrPastDemoBooked],
                    ["At or past Demo done", c.atOrPastDemoDone],
                    ["Pilot or Paid", c.pilotOrPaid],
                    ["Paid", c.paid],
                    ["Lost", c.lost],
                  ] as const
                ).map(([label, n]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className="text-right tabular-nums">{n.toLocaleString()}</td>
                    <td className="w-16 text-right text-xs text-muted-foreground tabular-nums">
                      {label === "Created" ? "" : (ratePct(n, c.created) ?? "")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <SmallSampleNote n={c.created} />
        </Panel>

        <Panel title="Demo requests by campaign" note="Which campaigns' requests reached the pipeline, a demo, and payment.">
          {d.byCampaign.length === 0 ? (
            <Empty>No demo requests in this period.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-dense w-full">
                <thead>
                  <tr>
                    <th className="text-left">Campaign</th>
                    <th className="text-right">Requests</th>
                    <th className="text-right">In pipeline</th>
                    <th className="text-right">Demo done+</th>
                    <th className="text-right">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {d.byCampaign.map((row) => (
                    <tr key={row.campaign}>
                      <td>{row.campaign}</td>
                      <td className="text-right tabular-nums">{row.requests}</td>
                      <td className="text-right tabular-nums">{row.inPipeline}</td>
                      <td className="text-right tabular-nums">{row.reachedDemo}</td>
                      <td className="text-right tabular-nums">{row.paid}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Top 10 campaigns. &ldquo;Demo done+&rdquo; and &ldquo;Paid&rdquo; count only requests that were added to the
            pipeline, using each lead&apos;s current stage. Requests with no campaign tag appear as (none).
          </p>
        </Panel>

        <Panel title="Lost leads" note="Leads marked Lost in this period, with the reason staff recorded.">
          <Stat label="Marked lost" value={report.lost.inPeriod} />
          {report.lost.reasons.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {report.lost.reasons.map((r) => (
                <li key={r.label} className="flex items-baseline gap-2">
                  <span className="font-semibold tabular-nums">{r.n}</span>
                  <span className="text-muted-foreground">{r.label}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Trials started"
          note="Schools that started a trial in this period, and where they are now. Includes any internal test or demo schools."
        >
          <div className="flex flex-wrap gap-6">
            <Stat label="Trials started" value={t.started} />
            <Stat label="Have paid an invoice" value={t.paidInvoice} hint={ratePct(t.paidInvoice, t.started) ?? undefined} />
          </div>
          {t.started > 0 && (
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {Object.entries(t.byStatus).map(([status, n]) => (
                <li key={status} className="flex items-baseline gap-1.5">
                  <span className="font-semibold tabular-nums">{n}</span>
                  <span className="text-muted-foreground">{status.replace(/_/g, " ")}</span>
                </li>
              ))}
            </ul>
          )}
          {t.byCampaign.length > 0 && (
            <div className="overflow-x-auto">
              <table className="table-dense w-full">
                <thead>
                  <tr>
                    <th className="text-left">Signup campaign</th>
                    <th className="text-right">Trials</th>
                    <th className="text-right">Paid an invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {t.byCampaign.map((row) => (
                    <tr key={row.campaign}>
                      <td>{row.campaign}</td>
                      <td className="text-right tabular-nums">{row.trials}</td>
                      <td className="text-right tabular-nums">{row.paidInvoice}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <SmallSampleNote n={t.started} />
        </Panel>

        <Panel
          title="Outreach AI usage"
          note="Tokens used by the outreach tools in this period. Tokens only: no verified prices are on file, so no cost is estimated, and other AI features are not logged here yet."
        >
          {report.aiUsage.length === 0 ? (
            <Empty>No outreach AI calls were logged in this period.</Empty>
          ) : (
            <table className="table-dense w-full">
              <thead>
                <tr>
                  <th className="text-left">Tool</th>
                  <th className="text-right">Calls</th>
                  <th className="text-right">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {report.aiUsage.map((u) => (
                  <tr key={u.action}>
                    <td>{aiActionLabel(u.action)}</td>
                    <td className="text-right tabular-nums">{u.calls.toLocaleString()}</td>
                    <td className="text-right tabular-nums">{u.totalTokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <div className="panel p-4">
        <p className="text-sm font-medium">Not tracked yet</p>
        <p className="mb-2 text-xs text-muted-foreground">
          These have no real data source today, so they are not shown as zero.
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          {NOT_TRACKED_YET.map((n) => (
            <li key={n.label}>
              <span className="font-medium">{n.label}</span> <span className="text-xs text-muted-foreground">{n.why}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
