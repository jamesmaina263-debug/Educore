// WP 5.4 + 5.5: pure helpers for guardian bus alerts and bus roll-call boarding. No I/O. The database functions
// (set_bus_alert_mode, send_bus_test_alert, send_bus_delay_alert, record_bus_boarding, set_my_bus_alerts,
// cancel_unsent_bus_alerts) enforce every rule again; these only validate early and word the results.

export const BUS_ALERTS_FLAG = "feature.transport.guardian_alerts";

export type BusAlertMode = "off" | "test" | "live";
export type BoardingKind = "boarded" | "dropped_off";

export const DELAY_MIN_MINUTES = 5;
export const DELAY_MAX_MINUTES = 180;
export const DELAY_NOTE_MAX = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE_RE = /^\+?[0-9]{9,15}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
export const isBusAlertMode = (v: unknown): v is BusAlertMode => v === "off" || v === "test" || v === "live";
export const isBoardingKind = (v: unknown): v is BoardingKind => v === "boarded" || v === "dropped_off";

/** Strips spaces and hyphens like the database does. Returns null when blank, or the cleaned text (maybe invalid). */
export function cleanPhone(input: string | null | undefined): string | null {
  const v = (input ?? "").replace(/[\s-]/g, "");
  return v === "" ? null : v;
}

export function validatePhone(input: string | null | undefined): string | null {
  const v = cleanPhone(input);
  if (v === null) return null;
  return PHONE_RE.test(v) ? null : "Enter the test phone number with 9 to 15 digits, for example 0712345678.";
}

export function validateDelay(minutes: unknown, note: string | null | undefined): string | null {
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < DELAY_MIN_MINUTES || minutes > DELAY_MAX_MINUTES) {
    return `Delay must be a whole number of minutes from ${DELAY_MIN_MINUTES} to ${DELAY_MAX_MINUTES}.`;
  }
  const n = (note ?? "").trim();
  if (n.length > DELAY_NOTE_MAX) return `The note must be ${DELAY_NOTE_MAX} characters or fewer.`;
  if (CONTROL_RE.test(n)) return "The note cannot contain line breaks.";
  return null;
}

export interface BusAlertResult {
  mode: BusAlertMode;
  guardians: number;
  queued: number;
  skippedOptOut: number;
  skippedNoPhone: number;
  skippedQuietHours: number;
  eventId: string | null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** The jsonb the delay / boarding functions return. Anything unexpected parses to null (treated as "unknown"). */
export function parseAlertResult(data: unknown): BusAlertResult | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (!isBusAlertMode(d.mode)) return null;
  return {
    mode: d.mode,
    guardians: num(d.guardians),
    queued: num(d.queued),
    skippedOptOut: num(d.skipped_opt_out),
    skippedNoPhone: num(d.skipped_no_phone),
    skippedQuietHours: num(d.skipped_quiet_hours),
    eventId: typeof d.event_id === "string" ? d.event_id : null,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One plain sentence for staff describing exactly what happened, never claiming more than the database said. */
export function describeAlertResult(action: "delay" | BoardingKind, r: BusAlertResult, sent: number | null): string {
  const what = action === "delay" ? "Delay alert" : action === "boarded" ? "Boarding recorded" : "Drop-off recorded";
  if (r.mode === "off") {
    return action === "delay" ? "Alerts are switched off, so nothing was sent." : `${what}. Alerts are switched off, so no guardian was messaged.`;
  }
  if (r.mode === "test") {
    return `${what}. TEST MODE: ${sent === null ? "1 sample message was queued" : sent > 0 ? "1 sample message was sent" : "1 sample message was queued"} to your test phone only. No guardian was messaged (live mode would have reached ${plural(r.guardians, "guardian", "guardians")}).`;
  }
  const parts = [`${plural(r.queued, "guardian was", "guardians were")} messaged`];
  if (r.skippedOptOut) parts.push(`${r.skippedOptOut} opted out`);
  if (r.skippedNoPhone) parts.push(`${r.skippedNoPhone} had no phone number`);
  if (r.skippedQuietHours) parts.push(`${r.skippedQuietHours} held for quiet hours (8pm to 5am)`);
  return `${what}. ${parts.join("; ")}.`;
}

/** Friendly text for the database's refusals; unknown errors never leak details. */
export function mapBusAlertError(code: string | undefined): string {
  switch (code) {
    case "42501":
      return "You don't have permission to do that.";
    case "55000":
      return "Bus alerts are switched off or not enabled for this school.";
    case "22023":
      return "That isn't valid. Check the details and try again.";
    case "P0001":
      return "That was already sent a moment ago. Please wait 10 minutes before repeating it.";
    case "P0002":
      return "That learner, route or vehicle wasn't found, or the learner has no active bus assignment.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export const MODE_LABELS: Record<BusAlertMode, string> = {
  off: "Off: nothing is sent",
  test: "Test: sends only to the staff test phone",
  live: "Live: messages guardians",
};
