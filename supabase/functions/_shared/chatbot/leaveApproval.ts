// WP 4.5: approve or reject STAFF LEAVE (up to 5 days) from WhatsApp, for approvers who registered their own number
// (WP 3.3) and separately consented. Pure (no imports, no Deno globals) so it runs in the edge function AND in the
// app's unit tests (src/lib/bot-leave-approval.test.ts).
//
// The bot only parses what was typed and formats what the database returned. Everything that matters (flag, registration,
// consent, permission, not-your-own-leave, 5-day limit, one-time code, expiry, attempts, exactly-one-row update, retry
// safety) lives in the leave_wa_* functions and is re-checked there at every step. Any sender who is not a verified
// approver gets handled=false, so the message falls through to the director / guardian handling exactly as before.
// Any error also falls through: a database hiccup can never turn into an approval.

export type LeaveMessage =
  | { kind: "list" }
  | { kind: "decision"; decision: "approved" | "rejected"; ref: string }
  | { kind: "code"; code: string };

export function classifyLeaveMessage(raw: string): LeaveMessage | null {
  const text = raw.trim().toLowerCase().replace(/[.!\s]+$/g, "");
  if (/^(pending )?leave( requests?)?$/.test(text)) return { kind: "list" };
  const m = text.match(/^(approve|reject)\s+([0-9a-f]{4})$/);
  if (m) return { kind: "decision", decision: m[1] === "approve" ? "approved" : "rejected", ref: m[2].toUpperCase() };
  if (/^\d{6}$/.test(text)) return { kind: "code", code: text };
  return null;
}

export interface LeaveRpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}
export interface LeaveResult { handled: boolean; replies: string[] }

const NOT_HANDLED: LeaveResult = { handled: false, replies: [] };
const say = (...replies: string[]): LeaveResult => ({ handled: true, replies });

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(iso: unknown): string {
  const m = typeof iso === "string" ? iso.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""}`.trim() : "";
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const clean = (v: unknown, max = 40) => String(v ?? "").replace(/[\r\n*_~`]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export const LEAVE_TEXT = {
  list: (items: Record<string, unknown>[], inAppOnly: number) => {
    const lines = items.map((i, n) => {
      const days = Number(i.days);
      const when = `${shortDate(i.start)}${i.end && i.end !== i.start ? ` to ${shortDate(i.end)}` : ""}`;
      return `${n + 1}) ${clean(i.ref, 4)}: ${clean(i.name)}, ${clean(i.type)}, ${plural(days, "day")}${when ? ` (${when})` : ""}`;
    });
    const tail = inAppOnly > 0 ? `\n${plural(inAppOnly, "longer request")} must be decided in the app.` : "";
    return lines.length === 0
      ? `There is no pending leave you can decide on WhatsApp.${tail}`
      : `Pending leave (up to 5 days):\n${lines.join("\n")}\n\nTo decide, reply APPROVE or REJECT with the 4-character code, for example APPROVE ${clean(items[0].ref, 4)}. I will then send a 6-digit code to confirm.${tail}`;
  },
  codeIssued: (decision: string, name: string, days: number) =>
    `To ${decision === "approved" ? "approve" : "reject"} ${clean(name)}'s ${plural(days, "day")} of leave, reply with the 6-digit code in my next message. It expires in 5 minutes and works once. Do not share it.`,
  codeMessage: (code: string) => `Your code: ${code}`,
  recorded: (decision: string) => `Done. The leave was ${decision === "approved" ? "approved" : "rejected"} and the staff member has been notified.`,
  notFound: "I couldn't find that request. Send LEAVE to see what is pending.",
  ambiguous: "That code matches more than one request. Please decide this one in the app.",
  ownRequest: "You can't decide your own leave. Another approver needs to do it.",
  tooLong: "That request is longer than 5 days. Please decide it in the app.",
  rateLimited: "Too many attempts. Please wait a while and try again.",
  noCode: "I have no code waiting for you. Reply APPROVE or REJECT with a request code first (send LEAVE to see them).",
  wrongCode: (left: number) => `That code is not right. ${plural(left, "attempt")} left.`,
  locked: "Too many wrong codes. That code is cancelled. Start again with APPROVE or REJECT.",
  expired: "That code has expired. Start again with APPROVE or REJECT.",
  noLongerPending: "That request is no longer pending, so nothing was changed.",
};

/** handled=false: not a verified approver, not leave, or any error. The webhook then carries on exactly as before. */
export async function tryHandleLeaveApproval(input: { supabase: LeaveRpcClient; phone: string; text: string; messageSid: string | null }): Promise<LeaveResult> {
  const msg = classifyLeaveMessage(input.text);
  if (!msg) return NOT_HANDLED;
  try {
    if (msg.kind === "list") {
      const { data, error } = await input.supabase.rpc("leave_wa_pending", { p_phone: input.phone });
      if (error || !isRecord(data) || data.status !== "ok" || !Array.isArray(data.items)) return NOT_HANDLED;
      const items = data.items.filter(isRecord);
      return say(LEAVE_TEXT.list(items, Number(data.in_app_only) || 0));
    }

    if (msg.kind === "decision") {
      const { data, error } = await input.supabase.rpc("leave_wa_request_code", { p_phone: input.phone, p_ref: msg.ref, p_decision: msg.decision });
      if (error || !isRecord(data) || typeof data.status !== "string") return NOT_HANDLED;
      switch (data.status) {
        case "code_issued": {
          const code = typeof data.code === "string" && /^\d{6}$/.test(data.code) ? data.code : null;
          if (!code) return NOT_HANDLED;
          return say(LEAVE_TEXT.codeIssued(msg.decision, clean(data.name), Number(data.days) || 0), LEAVE_TEXT.codeMessage(code));
        }
        case "not_found": return say(LEAVE_TEXT.notFound);
        case "ambiguous": return say(LEAVE_TEXT.ambiguous);
        case "own_request": return say(LEAVE_TEXT.ownRequest);
        case "too_long": return say(LEAVE_TEXT.tooLong);
        case "rate_limited": return say(LEAVE_TEXT.rateLimited);
        default: return NOT_HANDLED; // not_approver or anything unknown
      }
    }

    const { data, error } = await input.supabase.rpc("leave_wa_decide", { p_phone: input.phone, p_code: msg.code, p_message_sid: input.messageSid });
    if (error || !isRecord(data) || typeof data.status !== "string") return NOT_HANDLED;
    switch (data.status) {
      case "recorded": return say(LEAVE_TEXT.recorded(String(data.decision)));
      case "duplicate": return { handled: true, replies: [] }; // a Twilio retry of a message already answered
      case "no_code": return say(LEAVE_TEXT.noCode);
      case "wrong_code": return say(LEAVE_TEXT.wrongCode(Number(data.attempts_left) || 0));
      case "locked": return say(LEAVE_TEXT.locked);
      case "expired": return say(LEAVE_TEXT.expired);
      case "no_longer_pending": return say(LEAVE_TEXT.noLongerPending);
      case "own_request": return say(LEAVE_TEXT.ownRequest);
      case "too_long": return say(LEAVE_TEXT.tooLong);
      default: return NOT_HANDLED; // not_approver or anything unknown
    }
  } catch {
    return NOT_HANDLED;
  }
}
