// Trial nudges: pure helpers. The database (supabase/migrations/20261018220000_trial_nudges.sql) is the authority
// for every rule; these mirror the content rules so the form can show a readable problem before anything is
// proposed, and decide what to show for each status. Nothing here sends an email.

export const NUDGE_KINDS = ["service", "promotional"] as const;
export type NudgeKind = (typeof NUDGE_KINDS)[number];

export const NUDGE_STATUSES = ["proposed", "approved", "rejected", "cancelled", "expired", "queued", "sent", "failed"] as const;
export type NudgeStatus = (typeof NUDGE_STATUSES)[number];

export const KIND_LABELS: Record<NudgeKind, string> = {
  service: "Service message",
  promotional: "Promotional message",
};

export const STATUS_LABELS: Record<NudgeStatus, string> = {
  proposed: "Waiting for review",
  approved: "Approved, not sent",
  rejected: "Rejected",
  cancelled: "Withdrawn",
  expired: "Expired",
  queued: "Sending",
  sent: "Sent",
  failed: "Failed",
};

/** Mirrors of the limits enforced in the database, for display only. */
export const LIMITS = {
  minDaysBetweenMessages: 3,
  maxPromotionalPer30Days: 2,
  maxPerDayPlatformWide: 30,
  approvalValidHours: 24,
  proposalValidDays: 7,
  winBackDays: 14,
} as const;

export const SUBJECT_MAX = 200;
export const BODY_MAX = 4000;
export const NOTE_MAX = 500;

export function isNudgeKind(v: unknown): v is NudgeKind {
  return typeof v === "string" && (NUDGE_KINDS as readonly string[]).includes(v);
}

// Claims the product must not make (wording rules from the Growth Engine handover).
const BANNED_PHRASES = [
  "no obligation",
  "kicd approved",
  "kicd-approved",
  "approved by kicd",
  "ministry approved",
  "ministry-approved",
  "approved by the ministry",
  "guaranteed",
  "free forever",
];

const DOMAIN_RE =
  /((?:[a-z0-9][a-z0-9-]*\.)+(?:com|co\.ke|or\.ke|ac\.ke|sc\.ke|org|net|io|app|me|ly|info|biz|xyz|link|ke))\b/g;

const OFFER_RE =
  /(\b(discount|discounted|promo|promotion|promotional|coupon|voucher|waive|waived)\b|% off|percent off|special offer|limited[- ]time|free month)/;

/**
 * The same content rules the database applies. Returns a plain-language problem, or null when the text is fine.
 * Order matches the database function so both report the same first problem.
 */
export function contentProblem(kind: unknown, subject: unknown, body: unknown): string | null {
  if (!isNudgeKind(kind)) return "Choose service or promotional.";
  const s = typeof subject === "string" ? subject.trim() : "";
  const b = typeof body === "string" ? body.trim() : "";
  if (s === "") return "Subject is required.";
  if (s.length > SUBJECT_MAX) return `Subject is too long (max ${SUBJECT_MAX} characters).`;
  if (b === "") return "Message is required.";
  if (b.length > BODY_MAX) return `Message is too long (max ${BODY_MAX} characters).`;

  const v = `${typeof subject === "string" ? subject : ""}\n${typeof body === "string" ? body : ""}`.toLowerCase();

  for (const phrase of BANNED_PHRASES) {
    if (v.includes(phrase)) return `Remove "${phrase}": EduCore does not make that claim.`;
  }
  if (/(\{\{|\}\})/.test(v.replace(/\{\{\s*(name|school)\s*\}\}/g, ""))) {
    return "Only {{name}} and {{school}} can be used as placeholders.";
  }
  for (const m of v.matchAll(DOMAIN_RE)) {
    const d = m[1];
    if (d !== "educoreafrica.com" && !d.endsWith(".educoreafrica.com")) {
      return `Links and addresses may only point to educoreafrica.com (found "${d}").`;
    }
  }
  if (kind === "service" && OFFER_RE.test(v)) {
    return "This reads like an offer. Send it as a promotional message instead.";
  }
  return null;
}

export function validateProposal(input: { kind: unknown; subject: unknown; body: unknown }):
  | { ok: true; kind: NudgeKind; subject: string; body: string }
  | { ok: false; error: string } {
  const problem = contentProblem(input.kind, input.subject, input.body);
  if (problem) return { ok: false, error: problem };
  return { ok: true, kind: input.kind as NudgeKind, subject: (input.subject as string).trim(), body: (input.body as string).trim() };
}

/** An approval is only good for a day. Returns the instant it lapses, or null when there is no approval. */
export function approvalExpiresAt(reviewedAt: string | null): Date | null {
  if (!reviewedAt) return null;
  const t = new Date(reviewedAt).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + LIMITS.approvalValidHours * 3_600_000);
}

export function approvalLapsed(reviewedAt: string | null, now: Date = new Date()): boolean {
  const at = approvalExpiresAt(reviewedAt);
  return at !== null && at.getTime() <= now.getTime();
}

export function proposalLapsed(createdAt: string, now: Date = new Date()): boolean {
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && t + LIMITS.proposalValidDays * 86_400_000 <= now.getTime();
}

/** Open work first (waiting, approved, sending), then history, each newest first. */
export function splitQueue<T extends { status: string; created_at: string }>(rows: readonly T[]): { open: T[]; history: T[] } {
  const newestFirst = (a: T, b: T) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  const open = rows.filter((r) => r.status === "proposed" || r.status === "approved" || r.status === "queued").sort(newestFirst);
  const history = rows.filter((r) => !(r.status === "proposed" || r.status === "approved" || r.status === "queued")).sort(newestFirst);
  return { open, history };
}

/** How many have been sent or are sending in the last 24 hours (for the platform-wide daily limit display). */
export function sentInLast24h(rows: readonly { status: string; sent_at: string | null; queued_at: string | null }[], now: Date = new Date()): number {
  const cutoff = now.getTime() - 86_400_000;
  return rows.filter((r) => {
    if (r.status !== "queued" && r.status !== "sent") return false;
    const t = new Date(r.sent_at ?? r.queued_at ?? "").getTime();
    return Number.isFinite(t) && t > cutoff;
  }).length;
}

/**
 * Starting points for SERVICE messages. They state only facts the product can stand behind (the 30-day free trial,
 * no card required) and make no offer, price or approval claim. A person edits and approves them like any other text.
 * There is deliberately no promotional starter: an offer must be written, and be true, by whoever proposes it.
 */
export const SERVICE_STARTERS: { key: string; label: string; subject: string; body: string }[] = [
  {
    key: "welcome",
    label: "Welcome",
    subject: "Welcome to your EduCore trial, {{school}}",
    body:
      "Hello {{name}},\n\nWelcome to EduCore. Your 30-day free trial for {{school}} is running. No card required.\n\n" +
      "A good first step is to add your classes and staff, then try the parts of EduCore your school uses most. " +
      "If you would like a hand, just reply to this email.\n\nThe EduCore team",
  },
  {
    key: "checkin",
    label: "Check-in",
    subject: "How is your EduCore trial going?",
    body:
      "Hello {{name}},\n\nWe are checking in on {{school}}'s EduCore trial. Is there anything we can set up or explain for you? " +
      "Reply to this email and we will help.\n\nThe EduCore team",
  },
  {
    key: "ending",
    label: "Trial ending soon",
    subject: "Your EduCore trial for {{school}} ends soon",
    body:
      "Hello {{name}},\n\nThe 30-day free trial for {{school}} is coming to an end. If EduCore has been useful, reply to this " +
      "email and we will go through what happens next. If something is stopping you, tell us and we will talk it through.\n\nThe EduCore team",
  },
];
