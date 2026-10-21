// Parsing and rates for admin_email_delivery_summary (20261021120000_email_delivery_events.sql), the "Email
// delivery" panel on /admin/analytics. The database counts the events; this validates the JSON so a changed or
// partial response never throws or shows NaN, and works out the two rates. Pure and unit-tested.

export type DeliveryTotals = { delivered: number; bounced: number; complained: number; delayed: number; failed: number };
export type SenderRow = { fromAddress: string; delivered: number; bounced: number; complained: number };
export type ProblemRow = {
  kenyaTime: string;
  type: "bounced" | "complained";
  to: string;
  subject: string | null;
  bounceType: string | null;
  reason: string | null;
};
export type EmailDeliverySummary = {
  totals: DeliveryTotals;
  senders: SenderRow[];
  problems: ProblemRow[];
  trackingSince: string | null;
  totalEvents: number;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function parseEmailDeliverySummary(raw: unknown): EmailDeliverySummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const t = obj(r.totals);
  const senders: SenderRow[] = Array.isArray(r.senders)
    ? r.senders.flatMap((s) => {
        const o = obj(s);
        return [{ fromAddress: str(o.from_address) ?? "(unknown)", delivered: num(o.delivered), bounced: num(o.bounced), complained: num(o.complained) }];
      })
    : [];
  const problems: ProblemRow[] = Array.isArray(r.problems)
    ? r.problems.flatMap((p) => {
        const o = obj(p);
        const type = o.event_type === "email.complained" ? "complained" : o.event_type === "email.bounced" ? "bounced" : null;
        if (!type) return [];
        return [{ kenyaTime: str(o.kenya_time) ?? "", type, to: str(o.to_address) ?? "(unknown)", subject: str(o.subject), bounceType: str(o.bounce_type), reason: str(o.bounce_reason) }];
      })
    : [];
  return {
    totals: { delivered: num(t.delivered), bounced: num(t.bounced), complained: num(t.complained), delayed: num(t.delayed), failed: num(t.failed) },
    senders,
    problems,
    trackingSince: str(r.tracking_since),
    totalEvents: num(r.total_events),
  };
}

function pct(n: number, d: number): string | null {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : null;
}

/**
 * Bounce rate = bounced / (delivered + bounced): of the emails that reached a final outcome, how many were
 * rejected. Complaint rate = complained / delivered: a spam report can only follow a delivery.
 * Null when there is nothing to divide by.
 */
export function deliveryRates(t: DeliveryTotals): { bounceRate: string | null; complaintRate: string | null; outcomes: number } {
  const outcomes = t.delivered + t.bounced;
  return { bounceRate: pct(t.bounced, outcomes), complaintRate: pct(t.complained, t.delivered), outcomes };
}
