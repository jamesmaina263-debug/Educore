// Pure helpers for scheduled fee reminders (Phase 1.4). No I/O so they can be unit-tested.

export const REMINDER_FLAG = "feature.finance.scheduled_reminders";

export type ReminderFrequency = "weekly" | "fortnightly" | "monthly";
export type ReminderChannel = "sms" | "whatsapp";

export interface ReminderSchedule {
  enabled: boolean;
  frequency: ReminderFrequency;
  runWeekday: number; // 0 = Sunday .. 6 = Saturday
  runDayOfMonth: number; // 1..28
  channel: ReminderChannel;
  minBalance: number;
  minDaysBetween: number;
  /** A saved fee_reminder template from Communication > Templates; null = EduCore's default message. */
  templateId: string | null;
}

export const DEFAULT_SCHEDULE: ReminderSchedule = {
  enabled: false,
  frequency: "weekly",
  runWeekday: 1,
  runDayOfMonth: 1,
  channel: "sms",
  minBalance: 1,
  minDaysBetween: 14,
  templateId: null,
};

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const FREQUENCIES: ReminderFrequency[] = ["weekly", "fortnightly", "monthly"];
const CHANNELS: ReminderChannel[] = ["sms", "whatsapp"];

export function validateSchedule(input: ReminderSchedule): { error: string } | { value: ReminderSchedule } {
  if (!FREQUENCIES.includes(input.frequency)) return { error: "Choose weekly, fortnightly or monthly." };
  if (!CHANNELS.includes(input.channel)) return { error: "Choose SMS or WhatsApp." };
  if (!Number.isInteger(input.runWeekday) || input.runWeekday < 0 || input.runWeekday > 6) {
    return { error: "Choose a day of the week." };
  }
  if (!Number.isInteger(input.runDayOfMonth) || input.runDayOfMonth < 1 || input.runDayOfMonth > 28) {
    return { error: "Day of the month must be between 1 and 28." };
  }
  if (!Number.isFinite(input.minBalance) || input.minBalance <= 0) {
    return { error: "Minimum balance must be more than 0." };
  }
  if (!Number.isInteger(input.minDaysBetween) || input.minDaysBetween < 1 || input.minDaysBetween > 90) {
    return { error: "Days between reminders must be between 1 and 90." };
  }
  return { value: { ...input, enabled: Boolean(input.enabled) } };
}

export function describeSchedule(s: ReminderSchedule): string {
  const when =
    s.frequency === "monthly"
      ? `on day ${s.runDayOfMonth} of each month`
      : `${s.frequency === "weekly" ? "every" : "every other"} ${WEEKDAYS[s.runWeekday] ?? "week"}`;
  const channel = s.channel === "sms" ? "SMS" : "WhatsApp";
  return `Drafts ${when} for balances of KES ${s.minBalance.toLocaleString()} or more (${channel}), at most one reminder per family every ${s.minDaysBetween} days.`;
}

export type ReminderStatus = "draft" | "sent" | "dismissed" | "cancelled";

export function reminderTone(status: ReminderStatus): "warning" | "success" | "neutral" {
  if (status === "sent") return "success";
  if (status === "dismissed" || status === "cancelled") return "neutral";
  return "warning";
}

/** Placeholders the reminder renderer fills in. Mirrors fee_reminder_template_problem() in the database. */
export const TEMPLATE_PLACEHOLDERS = ["guardian_name", "student_name", "school_name", "balance"] as const;

/** Returns null when a template body is usable, otherwise a plain-language reason (database repeats this check). */
export function templateProblem(body: string | null | undefined): string | null {
  if (!body || body.trim().length === 0) return "The template message is empty.";
  if (body.length > 1000) return "The template is longer than 1000 characters.";
  for (const m of body.matchAll(/\{\{([^}]*)\}\}/g)) {
    if (!(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(m[1])) {
      return `The template uses {{${m[1]}}}, which is not supported. Use ${TEMPLATE_PLACEHOLDERS.map((k) => `{{${k}}}`).join(", ")}.`;
    }
  }
  return null;
}

/** What send_fee_reminder() can answer. */
export type SendOutcome = "sent" | "cancelled" | "refreshed" | "stale" | "hold";

export function describeSendOutcome(outcome: string): { ok: boolean; message: string } {
  switch (outcome) {
    case "sent":
      return { ok: true, message: "Approved and queued for delivery." };
    case "cancelled":
      return { ok: false, message: "Not sent. The reminder was cancelled (opt-out, no phone number, or nothing is owing any more). The reason is in History." };
    case "refreshed":
      return { ok: false, message: "The balance changed since this was drafted. The message now shows the current amount: please review it and approve again." };
    case "stale":
      return { ok: false, message: "The balance changed since this was drafted, and you edited the message by hand. Use \"Refresh from template\" or correct the amount, then approve again." };
    case "hold":
      return { ok: false, message: "A payment for this learner is in progress, so nothing was sent. Try again in a few minutes." };
    default:
      return { ok: false, message: "Unexpected result. Nothing was sent." };
  }
}

export type DeliveryStatus = "queued" | "sent" | "delivered" | "failed";

/** Slip pages carry only what the school office needs to hand over; split into groups of `perPage`. */
export function chunkSlips<T>(items: T[], perPage = 4): T[][] {
  const size = Math.max(1, Math.floor(perPage));
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}
