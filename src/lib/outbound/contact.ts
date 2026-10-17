// Pure helpers for the outreach contact log (PR 3 of the Growth Engine work).
// The database is the authority (admin_log_outbound_contact refuses unapproved prospects, unusable
// contacts and opted-out contacts); these helpers only mirror those rules so the UI can explain
// *why* a button is disabled instead of letting a click fail. Nothing here sends a message.

export const CONTACT_CHANNELS = ["email", "whatsapp"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

/** Events a rep can record from the UI. "opted_out" is written by the opt-out function only. */
export const MANUAL_CONTACT_EVENTS = ["draft_copied", "sent", "replied"] as const;
export type ManualContactEvent = (typeof MANUAL_CONTACT_EVENTS)[number];

export type ContactLogRow = {
  id?: string;
  prospect_id?: string;
  channel: string;
  event: string;
  created_at: string;
  performed_by?: string | null;
  note?: string | null;
};

export const CHANNEL_LABELS: Record<ContactChannel, string> = { email: "Email", whatsapp: "WhatsApp" };

export function isContactChannel(v: unknown): v is ContactChannel {
  return typeof v === "string" && (CONTACT_CHANNELS as readonly string[]).includes(v);
}

export function isManualContactEvent(v: unknown): v is ManualContactEvent {
  return typeof v === "string" && (MANUAL_CONTACT_EVENTS as readonly string[]).includes(v);
}

function channelLabel(channel: string): string {
  return isContactChannel(channel) ? CHANNEL_LABELS[channel] : channel === "sms" ? "SMS" : channel === "phone" ? "Phone" : channel;
}

/** "Copied WhatsApp draft", "Marked email as sent", ... — wording keeps it clear these are self-reported. */
export function describeContactEvent(channel: string, event: string): string {
  const ch = channelLabel(channel);
  switch (event) {
    case "draft_copied":
      return `Copied ${ch} draft`;
    case "sent":
      return `Marked ${ch} as sent`;
    case "replied":
      return `${ch} reply received`;
    case "opted_out":
      return `${ch} opt-out recorded`;
    default:
      return `${ch}: ${event}`;
  }
}

export type CopyGateInput = {
  status: string;
  /** outbound_prospects.contact_status: 'scraped' / 'ai_found' are unverified until a person confirms them. */
  contactStatus?: string | null;
  /** The prospect's address/number for this channel (null/empty = none found). */
  contactValue: string | null;
  /** From admin_is_outbound_contact_blocked for this channel; null while still loading. */
  blocked: boolean | null;
};

/** Why a draft cannot be copied/sent right now, or null if it can. Mirrors the database rules. */
export function contactBlockReason(input: CopyGateInput, channel: ContactChannel): string | null {
  if (input.status !== "approved" && input.status !== "promoted") {
    return "Approve this prospect before using a draft.";
  }
  if (input.contactStatus === "scraped" || input.contactStatus === "ai_found") {
    return "Confirm the found contact details before contacting this school.";
  }
  if (!input.contactValue || !input.contactValue.trim()) {
    return channel === "email" ? "No email address on file." : "No phone number on file.";
  }
  if (input.blocked === null) return "Checking opt-out status…";
  if (input.blocked) return "Opted out. Do not contact on this channel.";
  return null;
}

export type ProspectContactSummary = {
  /** Most recent non-opt-out event, newest first input assumed. */
  last: { channel: string; event: string; created_at: string } | null;
  /** Channels with an opted_out row. */
  optedOut: string[];
  contacts: number;
};

/** Group log rows by prospect for the list view. Input must be newest-first. */
export function summariseContactLog(rows: readonly ContactLogRow[]): Map<string, ProspectContactSummary> {
  const out = new Map<string, ProspectContactSummary>();
  for (const r of rows) {
    if (!r.prospect_id) continue;
    let s = out.get(r.prospect_id);
    if (!s) {
      s = { last: null, optedOut: [], contacts: 0 };
      out.set(r.prospect_id, s);
    }
    if (r.event === "opted_out") {
      if (!s.optedOut.includes(r.channel)) s.optedOut.push(r.channel);
      continue;
    }
    if (r.event === "draft_copied" || r.event === "sent") s.contacts += 1;
    if (!s.last) s.last = { channel: r.channel, event: r.event, created_at: r.created_at };
  }
  return out;
}

export type ContactInputCheck =
  | { ok: true; channel: ContactChannel; event: ManualContactEvent; note: string | null }
  | { ok: false; error: string };

export function validateContactInput(channel: unknown, event: unknown, note: unknown): ContactInputCheck {
  if (!isContactChannel(channel)) return { ok: false, error: "Unknown channel." };
  if (!isManualContactEvent(event)) return { ok: false, error: "Unknown event." };
  const n = typeof note === "string" ? note.trim() : "";
  if (n.length > 500) return { ok: false, error: "Note is too long (max 500 characters)." };
  return { ok: true, channel, event, note: n === "" ? null : n };
}

export const OPT_OUT_REASONS = ["stop_reply", "requested", "complained"] as const;
export type OptOutReason = (typeof OPT_OUT_REASONS)[number];
export function isOptOutReason(v: unknown): v is OptOutReason {
  return typeof v === "string" && (OPT_OUT_REASONS as readonly string[]).includes(v);
}
