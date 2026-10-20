// Sales WhatsApp (first PR): pure helpers for the consent register and the approval queue. The database
// (supabase/migrations/20261019160000_sales_whatsapp_consent_queue.sql) is the authority for every rule; these mirror
// the input rules so the form can show a readable problem first, and decide what to show for each status.
// Nothing here sends a WhatsApp message: a person sends an approved message from their own WhatsApp.

import { contentProblem as emailContentProblem, type NudgeKind } from "./trial-nudges";

export { approvalLapsed, approvalExpiresAt, proposalLapsed, splitQueue } from "./trial-nudges";

export type WhatsAppKind = NudgeKind;
export const WHATSAPP_KINDS = ["service", "promotional"] as const;

export const KIND_LABELS: Record<WhatsAppKind, string> = {
  service: "About their demo or trial",
  promotional: "Promotional",
};

export const STATUS_LABELS = {
  proposed: "Waiting for review",
  approved: "Approved, not sent",
  rejected: "Rejected",
  cancelled: "Withdrawn",
  expired: "Expired",
  sent: "Marked as sent",
} as const;
export type WhatsAppStatus = keyof typeof STATUS_LABELS;

export const HOW_OPTIONS = [
  { value: "call", label: "On a phone call" },
  { value: "in_person", label: "In person" },
  { value: "whatsapp_reply", label: "In a WhatsApp reply" },
  { value: "email", label: "By email" },
  { value: "other", label: "Another way" },
] as const;
export type AgreedHow = (typeof HOW_OPTIONS)[number]["value"];

export const SCOPE_OPTIONS = [
  { value: "service", label: "Messages about their demo and trial only" },
  { value: "service_and_promotional", label: "Also promotional messages and offers" },
] as const;
export type AgreementScope = (typeof SCOPE_OPTIONS)[number]["value"];

export const SOURCE_LABELS: Record<string, string> = {
  demo_form: "Ticked the box on the demo form",
  team_recorded: "Recorded by a team member",
};

/** Mirrors of the limits enforced in the database, for display only. */
export const LIMITS = {
  minDaysBetweenMessages: 2,
  maxPromotionalPer30Days: 2,
  maxPerDayPlatformWide: 40,
  bodyMax: 1000,
  noteMax: 500,
  nameMax: 120,
} as const;

export function isHow(v: unknown): v is AgreedHow {
  return typeof v === "string" && HOW_OPTIONS.some((o) => o.value === v);
}
export function isScope(v: unknown): v is AgreementScope {
  return typeof v === "string" && SCOPE_OPTIONS.some((o) => o.value === v);
}
export function isKind(v: unknown): v is WhatsAppKind {
  return typeof v === "string" && (WHATSAPP_KINDS as readonly string[]).includes(v);
}

/**
 * Mirror of the database's _normalize_contact_identifier for phone channels: digits only; Kenyan numbers become
 * 254XXXXXXXXX; otherwise 9 to 15 digits. Returns null when it cannot be a number.
 */
export function normalizeWhatsAppNumber(raw: unknown): string | null {
  const d = String(raw ?? "").replace(/[^0-9]/g, "");
  if (/^254[17][0-9]{8}$/.test(d)) return d;
  if (/^0[17][0-9]{8}$/.test(d)) return `254${d.slice(1)}`;
  if (/^[17][0-9]{8}$/.test(d)) return `254${d}`;
  if (/^[0-9]{9,15}$/.test(d)) return d;
  return null;
}

export function displayNumber(phone: string): string {
  return `+${phone}`;
}

/** The text a person will send is sent exactly as written, so nothing could fill in placeholders. */
export function messageProblem(kind: unknown, body: unknown): string | null {
  const text = typeof body === "string" ? body : "";
  if (text.trim().length > LIMITS.bodyMax) return `Message is too long (max ${LIMITS.bodyMax} characters).`;
  if (/(\{\{|\}\})/.test(text)) {
    return "Write the person's name directly: placeholders are not filled in for WhatsApp messages.";
  }
  return emailContentProblem(kind, "WhatsApp message", body);
}

export function validateMessage(input: { kind: unknown; body: unknown }):
  | { ok: true; kind: WhatsAppKind; body: string }
  | { ok: false; error: string } {
  const problem = messageProblem(input.kind, input.body);
  if (problem) return { ok: false, error: problem };
  return { ok: true, kind: input.kind as WhatsAppKind, body: (input.body as string).trim() };
}

export type AgreementInput = {
  phone: unknown;
  name: unknown;
  schoolName?: unknown;
  how: unknown;
  scope: unknown;
  note?: unknown;
};

export function validateAgreement(input: AgreementInput):
  | { ok: true; phone: string; name: string; schoolName: string | null; how: AgreedHow; scope: AgreementScope; note: string | null }
  | { ok: false; error: string } {
  const phone = normalizeWhatsAppNumber(input.phone);
  if (!phone) return { ok: false, error: "That is not a usable phone number." };
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > LIMITS.nameMax) return { ok: false, error: `Enter the person's name (max ${LIMITS.nameMax} characters).` };
  if (!isHow(input.how)) return { ok: false, error: "Say how they agreed." };
  if (!isScope(input.scope)) return { ok: false, error: "Choose what they agreed to." };
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > LIMITS.noteMax) return { ok: false, error: `Note is too long (max ${LIMITS.noteMax} characters).` };
  const schoolName = typeof input.schoolName === "string" ? input.schoolName.trim().slice(0, 200) : "";
  return { ok: true, phone, name, schoolName: schoolName || null, how: input.how, scope: input.scope, note: note || null };
}

/** Opens WhatsApp (app or web) to this number with the approved text filled in; a person still presses send. */
export function whatsappLink(phone: string, body: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(body)}`;
}

/** Marked sent in the last 24 hours (for the platform-wide daily limit display). */
export function sentInLast24h(rows: readonly { status: string; sent_at: string | null }[], now: Date = new Date()): number {
  const cutoff = now.getTime() - 86_400_000;
  return rows.filter((r) => {
    if (r.status !== "sent") return false;
    const t = new Date(r.sent_at ?? "").getTime();
    return Number.isFinite(t) && t > cutoff;
  }).length;
}
