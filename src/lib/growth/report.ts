// Parsing and wording for admin_growth_report (20261017200000_growth_report.sql), the "Pipeline and
// conversion" section of /admin/analytics. The database computes every number; this only validates the
// JSON it returns (so a changed or partial response can never throw or show NaN) and words the results.
// Pure and unit-tested. Every figure is measured from EduCore's own records; nothing is estimated.

export type CampaignDemoRow = { campaign: string; requests: number; inPipeline: number; reachedDemo: number; paid: number };
export type CampaignTrialRow = { campaign: string; trials: number; paidInvoice: number };
export type CountRow = { label: string; n: number };
export type AiUsageRow = { action: string; calls: number; totalTokens: number };

export type GrowthReport = {
  from: string;
  to: string;
  demoRequests: { total: number; inPipeline: number; byCampaign: CampaignDemoRow[] };
  leadsCreated: { total: number; bySource: CountRow[] };
  pipelineNow: { byStage: Record<string, number>; open: number; overdueFollowups: number; dueToday: number; noFollowup: number };
  leadCohort: { created: number; atOrPastDemoBooked: number; atOrPastDemoDone: number; pilotOrPaid: number; paid: number; lost: number };
  lost: { inPeriod: number; reasons: CountRow[] };
  trials: { started: number; byStatus: Record<string, number>; paidInvoice: number; byCampaign: CampaignTrialRow[] };
  aiUsage: AiUsageRow[];
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() !== "" ? v : fallback;
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function rows(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)) : [];
}
function numberMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(obj(v))) out[k] = num(val);
  return out;
}

/** Returns null only if the response is not an object at all; missing sections become zeros / empty lists. */
export function parseGrowthReport(raw: unknown): GrowthReport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const demo = obj(r.demo_requests);
  const leads = obj(r.leads_created);
  const pipe = obj(r.pipeline_now);
  const cohort = obj(r.lead_cohort);
  const lost = obj(r.lost);
  const trials = obj(r.trials);

  return {
    from: str(r.from),
    to: str(r.to),
    demoRequests: {
      total: num(demo.total),
      inPipeline: num(demo.in_pipeline),
      byCampaign: rows(demo.by_campaign).map((c) => ({
        campaign: str(c.campaign, "(none)"),
        requests: num(c.requests),
        inPipeline: num(c.in_pipeline),
        reachedDemo: num(c.reached_demo),
        paid: num(c.paid),
      })),
    },
    leadsCreated: {
      total: num(leads.total),
      bySource: rows(leads.by_source).map((s) => ({ label: str(s.source, "unspecified"), n: num(s.n) })),
    },
    pipelineNow: {
      byStage: numberMap(pipe.by_stage),
      open: num(pipe.open),
      overdueFollowups: num(pipe.overdue_followups),
      dueToday: num(pipe.due_today),
      noFollowup: num(pipe.no_followup),
    },
    leadCohort: {
      created: num(cohort.created),
      atOrPastDemoBooked: num(cohort.at_or_past_demo_booked),
      atOrPastDemoDone: num(cohort.at_or_past_demo_done),
      pilotOrPaid: num(cohort.pilot_or_paid),
      paid: num(cohort.paid),
      lost: num(cohort.lost),
    },
    lost: {
      inPeriod: num(lost.in_period),
      reasons: rows(lost.reasons).map((x) => ({ label: str(x.reason, "(no reason)"), n: num(x.n) })),
    },
    trials: {
      started: num(trials.started),
      byStatus: numberMap(trials.by_status),
      paidInvoice: num(trials.paid_invoice),
      byCampaign: rows(trials.by_campaign).map((c) => ({
        campaign: str(c.campaign, "(none)"),
        trials: num(c.trials),
        paidInvoice: num(c.paid_invoice),
      })),
    },
    aiUsage: rows(r.ai_usage).map((u) => ({ action: str(u.action), calls: num(u.calls), totalTokens: num(u.total_tokens) })),
  };
}

/** "37.5%", or null when the denominator is zero (a rate of nothing is not 0%). */
export function ratePct(n: number, d: number): string | null {
  if (!(d > 0)) return null;
  return `${((n / d) * 100).toFixed(1)}%`;
}

/** Below this many items a percentage is an anecdote, not a trend. */
export const SMALL_SAMPLE = 10;
export function isSmallSample(n: number): boolean {
  return n > 0 && n < SMALL_SAMPLE;
}

const AI_ACTION_LABELS: Record<string, string> = {
  score_outbound_prospects: "Outreach scoring and drafts",
  enrich_outbound_prospects: "Outreach contact lookup",
};
export function aiActionLabel(action: string): string {
  return AI_ACTION_LABELS[action] ?? action;
}

/** Things this report cannot measure yet. Shown as "Not tracked yet", never as zero. */
export const NOT_TRACKED_YET: readonly { label: string; why: string }[] = [
  { label: "Demos attended and their outcomes", why: "Only the sales stage records this; there is no booking or attendance data." },
  { label: "Trial activation and onboarding milestones", why: "School-level usage signals are not collected per trial day." },
  { label: "Email, WhatsApp and social campaign engagement", why: "No campaign sending or delivery tracking is connected yet." },
  { label: "AI spend in money", why: "Only tokens are logged, and no verified prices are on file." },
];
