// Phase 2.4+2.5: helpers for Communication > Bot requests (staff queue of absence notes and phone-number
// change requests that guardians sent the WhatsApp bot). Pure, so vitest can test it.

export const BOT_REQUESTS_FLAG = "feature.bot.guardian_requests";

export type BotRequestKind = "absence_report" | "contact_update";
export type BotRequestStatus = "pending" | "acknowledged" | "applied" | "rejected" | "cancelled";
export type BotRequestDecision = "acknowledge" | "apply" | "reject";

/** One row as returned by the bot_requests_for_review() database function. */
export interface BotRequestRow {
  id: string;
  kind: BotRequestKind;
  status: BotRequestStatus;
  created_at: string;
  guardian_name: string | null;
  guardian_phone: string | null;
  student_name: string | null;
  absence_date: string | null;
  reason: string | null;
  new_phone: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  phone_conflict: boolean;
}

const KINDS: BotRequestKind[] = ["absence_report", "contact_update"];
const STATUSES: BotRequestStatus[] = ["pending", "acknowledged", "applied", "rejected", "cancelled"];

/** Defensive: the function returns jsonb; keep only well-formed rows and never throw on a surprise. */
export function parseBotRequestRows(data: unknown): BotRequestRow[] {
  if (!Array.isArray(data)) return [];
  const out: BotRequestRow[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string") continue;
    if (!KINDS.includes(r.kind as BotRequestKind)) continue;
    if (!STATUSES.includes(r.status as BotRequestStatus)) continue;
    const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : null);
    out.push({
      id: r.id,
      kind: r.kind as BotRequestKind,
      status: r.status as BotRequestStatus,
      created_at: s("created_at") ?? "",
      guardian_name: s("guardian_name"),
      guardian_phone: s("guardian_phone"),
      student_name: s("student_name"),
      absence_date: s("absence_date"),
      reason: s("reason"),
      new_phone: s("new_phone"),
      review_note: s("review_note"),
      reviewed_at: s("reviewed_at"),
      phone_conflict: r.phone_conflict === true,
    });
  }
  return out;
}

export function kindLabel(kind: BotRequestKind): string {
  return kind === "absence_report" ? "Absence note" : "Phone number change";
}

export function statusLabel(status: BotRequestStatus): string {
  switch (status) {
    case "pending":
      return "Waiting for the office";
    case "acknowledged":
      return "Acknowledged";
    case "applied":
      return "Number changed";
    case "rejected":
      return "Rejected";
    case "cancelled":
      return "Replaced";
  }
}

export function statusTone(status: BotRequestStatus): "warning" | "success" | "danger" | "neutral" {
  if (status === "pending") return "warning";
  if (status === "acknowledged" || status === "applied") return "success";
  if (status === "rejected") return "danger";
  return "neutral";
}

/** The decisions staff may take for a request of this kind. */
export function decisionsFor(kind: BotRequestKind): BotRequestDecision[] {
  return kind === "absence_report" ? ["acknowledge", "reject"] : ["apply", "reject"];
}

export function decisionLabel(decision: BotRequestDecision): string {
  return decision === "acknowledge" ? "Acknowledge" : decision === "apply" ? "Change the number" : "Reject";
}

export function isDecision(value: string): value is BotRequestDecision {
  return value === "acknowledge" || value === "apply" || value === "reject";
}
