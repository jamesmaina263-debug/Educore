// Pure builder for the daily "sales follow-ups" email -- no Deno or network access, so it is unit-tested from
// vitest (src/lib/followup-digest.test.ts) as well as imported by send-followup-digest.
//
// "Overdue", "due today" and "no follow-up set" use exactly the definitions of the Pipeline and conversion
// panel on /admin/analytics (admin_growth_report): open leads are every stage except paid and lost, and the
// comparison is against today's date in Kenya time.

export interface DigestLead {
  id: string;
  school_name: string;
  contact_name: string | null;
  phone: string | null;
  stage: string;
  next_follow_up_on: string | null; // YYYY-MM-DD
  town_county: string | null;
}

export interface FollowupDigest {
  subject: string;
  html: string;
  text: string;
  overdue: number;
  dueToday: number;
  noFollowUp: number;
}

export const MAX_ROWS_PER_SECTION = 20;

const STAGE_LABELS: Record<string, string> = {
  new: "New",
  visited: "Visited",
  decision_maker_met: "Decision-maker met",
  demo_booked: "Demo booked",
  demo_done: "Demo done",
  pilot: "Pilot",
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Today's date (YYYY-MM-DD) on the Kenya calendar. */
export function nairobiToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). Positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

function line(l: DigestLead, today: string): string {
  const parts = [l.school_name.trim()];
  if (l.town_county) parts.push(l.town_county.trim());
  const who = [l.contact_name?.trim(), l.phone?.trim()].filter(Boolean).join(", ");
  const late = l.next_follow_up_on && l.next_follow_up_on < today ? ` -- ${daysBetween(l.next_follow_up_on, today)}d overdue` : "";
  return `${parts.join(", ")} (${stageLabel(l.stage)})${who ? ` -- ${who}` : ""}${late}`;
}

/**
 * Returns null when there is nothing to chase (no overdue and none due today): no email is better than an
 * empty one. Leads with no follow-up date are mentioned as a count only.
 */
export function buildFollowupDigest(leads: DigestLead[], today: string, siteUrl: string): FollowupDigest | null {
  const open = leads.filter((l) => l.stage !== "paid" && l.stage !== "lost");
  const overdueAll = open
    .filter((l) => l.next_follow_up_on !== null && l.next_follow_up_on < today)
    .sort((a, b) => ((a.next_follow_up_on ?? "") < (b.next_follow_up_on ?? "") ? -1 : 1));
  const dueAll = open.filter((l) => l.next_follow_up_on === today);
  const noFollowUp = open.filter((l) => l.next_follow_up_on === null).length;
  if (overdueAll.length === 0 && dueAll.length === 0) return null;

  const pipelineUrl = `${siteUrl.replace(/\/$/, "")}/admin/sales-pipeline`;
  const subject = `Sales follow-ups: ${overdueAll.length} overdue, ${dueAll.length} due today`;

  const section = (title: string, rows: DigestLead[]) => {
    const shown = rows.slice(0, MAX_ROWS_PER_SECTION);
    const more = rows.length - shown.length;
    return { title, shown, more };
  };
  const sections = [section("Overdue", overdueAll), section("Due today", dueAll)].filter((s) => s.shown.length > 0);

  const text = [
    subject,
    "",
    ...sections.flatMap((s) => [
      `${s.title} (${s.shown.length + s.more})`,
      ...s.shown.map((l) => `- ${line(l, today)}`),
      ...(s.more > 0 ? [`- ...and ${s.more} more in the pipeline`] : []),
      "",
    ]),
    ...(noFollowUp > 0 ? [`${noFollowUp} open ${plural(noFollowUp, "lead has", "leads have")} no follow-up date set.`, ""] : []),
    `Open the pipeline: ${pipelineUrl}`,
  ].join("\n");

  const html = [
    `<p><strong>${escapeHtml(subject)}</strong></p>`,
    ...sections.map(
      (s) =>
        `<p><strong>${s.title} (${s.shown.length + s.more})</strong></p><ul>${s.shown
          .map((l) => `<li>${escapeHtml(line(l, today))}</li>`)
          .join("")}${s.more > 0 ? `<li>...and ${s.more} more in the pipeline</li>` : ""}</ul>`,
    ),
    noFollowUp > 0 ? `<p>${noFollowUp} open ${plural(noFollowUp, "lead has", "leads have")} no follow-up date set.</p>` : "",
    `<p><a href="${escapeHtml(pipelineUrl)}">Open the sales pipeline</a></p>`,
  ].join("\n");

  return { subject, html, text, overdue: overdueAll.length, dueToday: dueAll.length, noFollowUp };
}
