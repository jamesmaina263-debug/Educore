// Trial check-in log: pure helpers. The database (admin_log_trial_checkin) is the authority; these mirror
// its rules so the UI and server action can reject bad input early, and turn raw log rows into the
// per-school summary the follow-up page uses. Nothing here sends a message or changes a trial.

export const CHECKIN_CHANNELS = ["call", "whatsapp", "email", "visit", "other"] as const;
export type CheckinChannel = (typeof CHECKIN_CHANNELS)[number];

export const CHECKIN_OUTCOMES = [
  "reached_interested",
  "reached_needs_time",
  "reached_not_interested",
  "no_answer",
  "message_left",
  "asked_to_stop",
] as const;
export type CheckinOutcome = (typeof CHECKIN_OUTCOMES)[number];

/** A school checked in with within this many days is not suggested again (so nobody is chased twice). */
export const RECENT_CHECKIN_DAYS = 3;

export const CHANNEL_LABELS: Record<CheckinChannel, string> = {
  call: "Call",
  whatsapp: "WhatsApp",
  email: "Email",
  visit: "Visit",
  other: "Other",
};

export const OUTCOME_LABELS: Record<CheckinOutcome, string> = {
  reached_interested: "Reached: interested",
  reached_needs_time: "Reached: needs more time",
  reached_not_interested: "Reached: not interested",
  no_answer: "No answer",
  message_left: "Message left",
  asked_to_stop: "Asked not to be contacted",
};

export function isCheckinChannel(v: unknown): v is CheckinChannel {
  return typeof v === "string" && (CHECKIN_CHANNELS as readonly string[]).includes(v);
}
export function isCheckinOutcome(v: unknown): v is CheckinOutcome {
  return typeof v === "string" && (CHECKIN_OUTCOMES as readonly string[]).includes(v);
}

export type CheckinInputCheck =
  | { ok: true; channel: CheckinChannel; outcome: CheckinOutcome; note: string | null }
  | { ok: false; error: string };

export function validateCheckinInput(channel: unknown, outcome: unknown, note: unknown): CheckinInputCheck {
  if (!isCheckinChannel(channel)) return { ok: false, error: "Unknown channel." };
  if (!isCheckinOutcome(outcome)) return { ok: false, error: "Unknown outcome." };
  const n = typeof note === "string" ? note.trim() : "";
  if (n.length > 500) return { ok: false, error: "Note is too long (max 500 characters)." };
  return { ok: true, channel, outcome, note: n === "" ? null : n };
}

export type CheckinRow = {
  school_id: string;
  created_at: string;
  channel: string;
  outcome: string;
  performed_by: string | null;
};

export type LastCheckin = {
  at: string;
  channel: string;
  outcome: string;
  byName: string | null;
};

export type SchoolCheckinSummary = {
  last: LastCheckin;
  count: number;
  /** True once ANY check-in for the school was "asked_to_stop": that is a standing request, not a one-off. */
  askedToStop: boolean;
};

export function summariseCheckins(
  rows: readonly CheckinRow[],
  teamNames: ReadonlyMap<string, string>,
): Map<string, SchoolCheckinSummary> {
  const out = new Map<string, SchoolCheckinSummary>();
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (!Number.isFinite(t)) continue;
    const cur = out.get(r.school_id);
    const entry: LastCheckin = {
      at: r.created_at,
      channel: r.channel,
      outcome: r.outcome,
      byName: r.performed_by ? (teamNames.get(r.performed_by) ?? null) : null,
    };
    if (!cur) {
      out.set(r.school_id, { last: entry, count: 1, askedToStop: r.outcome === "asked_to_stop" });
    } else {
      cur.count += 1;
      if (r.outcome === "asked_to_stop") cur.askedToStop = true;
      if (t > new Date(cur.last.at).getTime()) cur.last = entry;
    }
  }
  return out;
}

/** Was the last check-in recent enough that the school should not be suggested again yet? */
export function isRecentlyCheckedIn(lastAt: string, nowDate: Date = new Date()): boolean {
  const t = new Date(lastAt).getTime();
  if (!Number.isFinite(t)) return false;
  const age = nowDate.getTime() - t;
  return age >= 0 && age < RECENT_CHECKIN_DAYS * 86_400_000;
}
