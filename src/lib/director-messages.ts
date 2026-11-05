// WP 3.1 / 3.2 formatting (director WhatsApp briefing, Saturday digest and alerts). Pure: no I/O, nothing is sent.
//
// The figures arrive from director_briefing_evaluate() / director_alerts_evaluate() (fixed queries, the same basis as the
// bot, the cashbook and the alerts). These functions only turn them into short plain text, and fail closed: a payload that
// does not look exactly right gives null, so a malformed row is counted and skipped, never sent with invented figures.
// The text is the BODY a later, separately approved step will put into a WhatsApp template; no template is chosen here.

export function formatKes(n: unknown): string {
  const v = typeof n === "number" ? n : typeof n === "string" && n.trim() !== "" ? Number(n) : NaN;
  if (!Number.isFinite(v)) return "KES 0";
  return "KES " + Math.round(v).toLocaleString("en-US");
}

function rec(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
function isoDate(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Wed 4 Nov" from a YYYY-MM-DD date, with no time-zone arithmetic (the date is already the Nairobi date). */
export function shortDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() !== Number(m[2]) - 1) return null;
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function feesLine(fees: Record<string, unknown> | null): string | null {
  if (!fees) return null;
  const outstanding = num(fees.outstanding);
  const owing = num(fees.learners_owing);
  if (outstanding === null || owing === null) return null;
  return `Outstanding fees: ${formatKes(outstanding)} across ${owing} learner${owing === 1 ? "" : "s"}.`;
}

/**
 * The morning briefing (Monday to Friday) or the Saturday digest. Returns null when the payload is malformed.
 * Unpaid money figures count confirmed, recorded and unallocated payments; "outstanding" is computed from invoices, so
 * unallocated payments are not netted off it, and the text says so.
 */
export function formatBriefing(payload: unknown): string | null {
  const p = rec(payload);
  if (!p) return null;
  const fees = feesLine(rec(p.fees));
  const collected = num(p.collected);
  if (fees === null || collected === null) return null;
  const note = "Outstanding is before any unallocated payments are matched.";

  if (p.kind === "morning") {
    const day = isoDate(p.school_day);
    const from = isoDate(p.collected_from);
    const to = isoDate(p.collected_to);
    const payments = num(p.payments);
    const att = rec(p.attendance);
    if (!day || !from || !to || payments === null || !att) return null;
    const active = num(att.active_learners);
    const marked = num(att.marked);
    const present = num(att.present);
    const late = num(att.late);
    const absent = num(att.absent);
    if (active === null || marked === null || present === null || late === null || absent === null) return null;
    const dayLabel = shortDate(day);
    const fromLabel = shortDate(from);
    const toLabel = shortDate(to);
    if (!dayLabel || !fromLabel || !toLabel) return null;
    const period = from === to ? fromLabel : `${fromLabel} to ${toLabel}`;
    const money = payments === 0 ? `Collections (${period}): nothing recorded.` : `Collections (${period}): ${formatKes(collected)} from ${payments} payment${payments === 1 ? "" : "s"}.`;
    const attendance = marked === 0
      ? `Attendance (${dayLabel}): not marked.`
      : `Attendance (${dayLabel}): ${present + late} of ${marked} marked in school (${present} present, ${late} late, ${absent} absent), ${active} active learners.`;
    return ["Good morning. School briefing:", money, attendance, fees, note].join("\n");
  }

  if (p.kind === "saturday") {
    const from = isoDate(p.week_from);
    const to = isoDate(p.week_to);
    const previous = num(p.previous_week);
    if (!from || !to || previous === null) return null;
    const fromLabel = shortDate(from);
    const toLabel = shortDate(to);
    if (!fromLabel || !toLabel) return null;
    const rate = p.attendance_rate_pct === null || p.attendance_rate_pct === undefined ? null : num(p.attendance_rate_pct);
    if (p.attendance_rate_pct !== null && p.attendance_rate_pct !== undefined && rate === null) return null;
    let trend = "";
    if (previous > 0) {
      const pct = Math.round(((collected - previous) / previous) * 100);
      trend = pct === 0 ? " (same as the week before)" : ` (${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% on the week before, ${formatKes(previous)})`;
    } else if (collected > 0) {
      trend = " (nothing recorded the week before)";
    }
    const money = `Collections ${fromLabel} to ${toLabel}: ${formatKes(collected)}${trend}.`;
    const attendance = rate === null ? "Attendance Mon to Fri: not marked." : `Attendance Mon to Fri: ${rate}% in school.`;
    return ["Weekly school digest:", money, attendance, fees, note].join("\n");
  }
  return null;
}

/** One alert. alertType is large_payment, collection_drop or low_attendance; null for anything else or a malformed payload. */
export function formatAlert(alertType: unknown, payload: unknown): string | null {
  const p = rec(payload);
  if (!p) return null;
  switch (alertType) {
    case "large_payment": {
      const amount = num(p.amount);
      if (amount === null || amount <= 0) return null;
      const methods: Record<string, string> = { mpesa: "M-Pesa", cash: "cash", bank: "bank", cheque: "cheque" };
      const method = typeof p.method === "string" && methods[p.method] ? ` by ${methods[p.method]}` : "";
      return `School alert: a large payment of ${formatKes(amount)} was just recorded${method}.`;
    }
    case "collection_drop": {
      const current = num(p.current);
      const previous = num(p.previous);
      const drop = num(p.drop_pct);
      if (current === null || previous === null || drop === null || previous <= 0) return null;
      return `School alert: collections so far are ${formatKes(current)}, ${Math.round(drop)}% lower than the same period last time (${formatKes(previous)}).`;
    }
    case "low_attendance": {
      const rate = num(p.rate_pct);
      const marked = num(p.marked);
      const active = num(p.active_learners);
      if (rate === null || marked === null || active === null || marked <= 0) return null;
      return `School alert: attendance today is ${Math.round(rate)}% (${marked} of ${active} active learners marked so far).`;
    }
    default:
      return null;
  }
}

export type DirectorBriefingRow = {
  log_id: string;
  school_id: string;
  school_user_id: string;
  phone: string;
  kind: string;
  payload: unknown;
};

export type DirectorBriefingSummary = {
  total: number;
  schools: number;
  directors: number;
  by_kind: { morning: number; saturday: number };
  /** Rows whose payload formats cleanly. Dry-run check only: the text is thrown away, never logged or returned. */
  formattable: number;
  unformattable: number;
};

export function summariseDirectorBriefings(rows: DirectorBriefingRow[] | null | undefined): DirectorBriefingSummary {
  const list = Array.isArray(rows) ? rows : [];
  const by_kind = { morning: 0, saturday: 0 };
  let formattable = 0;
  for (const r of list) {
    if (r.kind === "morning" || r.kind === "saturday") by_kind[r.kind] += 1;
    if (formatBriefing(r.payload) !== null) formattable += 1;
  }
  return {
    total: list.length,
    schools: new Set(list.map((r) => r.school_id)).size,
    directors: new Set(list.map((r) => r.school_user_id)).size,
    by_kind,
    formattable,
    unformattable: list.length - formattable,
  };
}
