// Manual demo booking on sales leads: pure helpers. The database (admin_book_sales_lead_demo and friends) is the
// authority; these mirror its rules so the UI and server actions can reject bad input early with readable
// messages, and decide what to show. Nothing here sends an invitation or touches a calendar.

export const DEMO_MODES = ["in_person", "video_call", "phone"] as const;
export type DemoMode = (typeof DEMO_MODES)[number];

export const DEMO_CLOSE_STATUSES = ["held", "no_show", "cancelled"] as const;
export type DemoCloseStatus = (typeof DEMO_CLOSE_STATUSES)[number];
export type DemoStatus = "scheduled" | DemoCloseStatus;

export const MODE_LABELS: Record<DemoMode, string> = {
  in_person: "In person",
  video_call: "Video call",
  phone: "Phone",
};

export const STATUS_LABELS: Record<DemoStatus, string> = {
  scheduled: "Scheduled",
  held: "Held",
  no_show: "No-show",
  cancelled: "Cancelled",
};

export type DemoRow = {
  id: string;
  lead_id: string;
  scheduled_for: string;
  mode: string;
  location_note: string | null;
  host_id: string | null;
  status: string;
  outcome_note: string | null;
  status_changed_at: string;
};

export function isDemoMode(v: unknown): v is DemoMode {
  return typeof v === "string" && (DEMO_MODES as readonly string[]).includes(v);
}
export function isDemoCloseStatus(v: unknown): v is DemoCloseStatus {
  return typeof v === "string" && (DEMO_CLOSE_STATUSES as readonly string[]).includes(v);
}

/**
 * Turns the value of a `datetime-local` input ("2026-10-25T14:30", no zone) into a UTC ISO string, reading it as
 * East Africa Time (UTC+3, no daylight saving). Returns null for anything that is not a real date and time
 * (so "2026-02-31T10:00" is rejected rather than rolled into March).
 */
export function eatLocalToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const utc = Date.UTC(y, mo - 1, d, h - 3, mi);
  const check = new Date(utc + 3 * 3_600_000);
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== h ||
    check.getUTCMinutes() !== mi
  ) {
    return null;
  }
  return new Date(utc).toISOString();
}

/** The inverse, for pre-filling a datetime-local input from a stored instant. */
export function isoToEatLocal(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  return new Date(t + 3 * 3_600_000).toISOString().slice(0, 16);
}

export type BookingInput = {
  scheduledLocal: string; // datetime-local value, read as EAT
  mode: string;
  locationNote?: string | null;
};

export type BookingCheck =
  | { ok: true; scheduledFor: string; mode: DemoMode; locationNote: string | null }
  | { ok: false; error: string };

export function validateBookingInput(input: BookingInput, now: Date = new Date()): BookingCheck {
  const iso = eatLocalToIso(typeof input.scheduledLocal === "string" ? input.scheduledLocal : "");
  if (!iso) return { ok: false, error: "Pick a valid date and time." };
  if (new Date(iso).getTime() <= now.getTime()) return { ok: false, error: "Pick a date and time in the future." };
  if (!isDemoMode(input.mode)) return { ok: false, error: "Pick how the demo will happen." };
  const loc = typeof input.locationNote === "string" ? input.locationNote.trim() : "";
  if (loc.length > 300) return { ok: false, error: "Location / link is too long (max 300 characters)." };
  return { ok: true, scheduledFor: iso, mode: input.mode, locationNote: loc === "" ? null : loc };
}

export function validateRescheduleInput(scheduledLocal: string, now: Date = new Date()): { ok: true; scheduledFor: string } | { ok: false; error: string } {
  const iso = eatLocalToIso(typeof scheduledLocal === "string" ? scheduledLocal : "");
  if (!iso) return { ok: false, error: "Pick a valid date and time." };
  if (new Date(iso).getTime() <= now.getTime()) return { ok: false, error: "Pick a date and time in the future." };
  return { ok: true, scheduledFor: iso };
}

export type CloseCheck =
  | { ok: true; status: DemoCloseStatus; note: string | null }
  | { ok: false; error: string };

export function validateCloseInput(status: unknown, note: unknown): CloseCheck {
  if (!isDemoCloseStatus(status)) return { ok: false, error: "Unknown status." };
  const n = typeof note === "string" ? note.trim() : "";
  if (n.length > 500) return { ok: false, error: "Note is too long (max 500 characters)." };
  return { ok: true, status, note: n === "" ? null : n };
}

/** A scheduled demo whose start time has passed: someone still needs to record what happened. */
export function needsOutcome(d: Pick<DemoRow, "status" | "scheduled_for">, now: Date = new Date()): boolean {
  if (d.status !== "scheduled") return false;
  const t = new Date(d.scheduled_for).getTime();
  return Number.isFinite(t) && t <= now.getTime();
}

/** Scheduled demos, soonest first. Past-due ones (needing an outcome) come first so they are not missed. */
export function openDemos(demos: readonly DemoRow[]): DemoRow[] {
  return demos
    .filter((d) => d.status === "scheduled")
    .slice()
    .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());
}

/** Newest first, for the per-lead history. */
export function demoHistory(demos: readonly DemoRow[]): DemoRow[] {
  return demos.slice().sort((a, b) => new Date(b.scheduled_for).getTime() - new Date(a.scheduled_for).getTime());
}
