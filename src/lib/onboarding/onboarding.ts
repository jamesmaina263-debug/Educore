// School Onboarding & Engagement Monitor: shared types, labels and small pure helpers.
//
// Statuses, progress and priority are NOT calculated here. They come from the database (_onboarding_rows() in
// 20261030063047_school_onboarding_monitor.sql), which derives them from real records at read time. This file only
// names them for the screen, picks a recommended next action, and parses the list page's query string.

export const ONBOARDING_STATUSES = [
  "password_pending",
  "not_started",
  "logged_in_no_setup",
  "setting_up",
  "complete",
  "inactive",
] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export const STATUS_LABELS: Record<OnboardingStatus, string> = {
  password_pending: "Password pending",
  not_started: "Not started",
  logged_in_no_setup: "Logged in – no setup",
  setting_up: "Setting up",
  complete: "Onboarding complete",
  inactive: "Inactive",
};

// Colour is only ever a second cue next to the text label. Tokens come from the existing admin theme.
export const STATUS_TONE: Record<OnboardingStatus, string> = {
  password_pending: "border-amber-300 bg-amber-50 text-amber-900",
  not_started: "border-border bg-muted text-foreground",
  logged_in_no_setup: "border-amber-300 bg-amber-50 text-amber-900",
  setting_up: "border-primary/30 bg-primary-subtle text-primary",
  complete: "border-emerald-300 bg-emerald-50 text-emerald-900",
  inactive: "border-destructive/40 bg-destructive/10 text-destructive",
};

export const PRIORITIES = ["high", "medium", "low", "none"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low", none: "None" };
export const PRIORITY_TONE: Record<Priority, string> = {
  high: "border-destructive/40 bg-destructive/10 text-destructive",
  medium: "border-amber-300 bg-amber-50 text-amber-900",
  low: "border-border bg-muted text-muted-foreground",
  none: "border-transparent text-muted-foreground",
};

export function isOnboardingStatus(v: unknown): v is OnboardingStatus {
  return typeof v === "string" && (ONBOARDING_STATUSES as readonly string[]).includes(v);
}
export function isPriority(v: unknown): v is Priority {
  return typeof v === "string" && (PRIORITIES as readonly string[]).includes(v);
}

export const RULE_LABELS: Record<string, string> = {
  password_reminder_email: "Automatic password reminder email",
  login_guidance_email: "Automatic login guidance email",
  password_pending_48h: "Password still not changed after 48 hours: personal follow-up",
  no_setup_48h: "Logged in but no setup after 48 hours: guided onboarding",
  inactive_7d: "No meaningful activity: inactive",
  manual_password_reminder: "Password reminder requested by the team",
  manual_login_guidance: "Login guidance requested by the team",
};

export const FOLLOWUP_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  resolved: "Resolved",
  dismissed: "Dismissed",
  pending_approval: "Waiting for approval",
  queued: "Queued to send",
  sent: "Sent",
  failed: "Failed",
  skipped: "Not sent (checked first)",
};

export const AUDIT_EVENT_LABELS: Record<string, string> = {
  alert_generated: "Alert raised",
  alert_resolved: "Alert resolved",
  alert_dismissed: "Alert dismissed",
  email_approved: "Email approved",
  email_queued: "Email queued",
  email_skipped: "Email not queued",
  delivery_attempted: "Delivery attempted",
  delivery_succeeded: "Delivery succeeded",
  delivery_failed: "Delivery failed",
  send_cancelled_safety: "Send cancelled by safety check",
  manual_followup_proposed: "Follow-up proposed by the team",
  note_added: "Note added",
  settings_changed: "Settings changed",
  templates_approved: "Templates approved",
  milestone_changed: "Milestone changed",
};

export const NOTE_KINDS = ["call", "demo", "challenge", "other"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const NOTE_KIND_LABELS: Record<NoteKind, string> = {
  call: "Phone call",
  demo: "Demonstration",
  challenge: "Challenge reported",
  other: "Other",
};
export const NOTE_MAX = 2000;
export function isNoteKind(v: unknown): v is NoteKind {
  return typeof v === "string" && (NOTE_KINDS as readonly string[]).includes(v);
}

export const MANUAL_RULES = ["password_reminder_email", "login_guidance_email"] as const;
export type ManualRule = (typeof MANUAL_RULES)[number];
export function isManualRule(v: unknown): v is ManualRule {
  return typeof v === "string" && (MANUAL_RULES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------------------------------------------
// Shapes returned by the database functions
// ---------------------------------------------------------------------------------------------------------------

export type OnboardingSummary = {
  total: number;
  password_pending: number;
  not_started: number;
  logged_in_no_setup: number;
  setting_up: number;
  complete: number;
  inactive: number;
  open_alerts: number;
  automation_active: boolean;
};

export type OnboardingListRow = {
  school_id: string;
  school_name: string;
  school_status: string;
  registered_at: string;
  admin_name: string | null;
  admin_email: string | null;
  password_changed_at: string | null;
  first_login_at: string | null;
  last_login_at: string | null;
  student_count: number;
  class_count: number;
  progress_pct: number;
  status: string;
  days_since_activity: number | null;
  priority: string;
  total_count: number;
};

export type FollowupQueueRow = {
  followup_id: string;
  created_at: string;
  school_id: string;
  school_name: string;
  admin_name: string | null;
  admin_email: string | null;
  rule_key: string;
  kind: string;
  status: string;
  onboarding_status: string;
  priority: string;
  total_count: number;
};

export type MilestoneConfig = {
  key: string;
  label: string;
  grp: "account" | "setup";
  weight: number;
  required: boolean;
  enabled: boolean;
  sort_order: number;
};

export type OnboardingConfig = {
  settings: {
    automation_enabled: boolean;
    automation_start_at: string;
    password_tracking_started_at: string;
    password_reminder_hours: number;
    password_flag_hours: number;
    login_guidance_hours: number;
    no_setup_flag_hours: number;
    inactive_days: number;
    templates_approved_at: string | null;
    updated_at: string;
  };
  templates_hash: string;
  templates_approved: boolean;
  templates: { rule_key: string; subject: string; body: string }[];
  milestones: MilestoneConfig[];
  trial_nudge_sending_enabled: boolean;
  automation_active: boolean;
};

export type SchoolFacts = {
  school_id: string;
  school_name: string;
  school_status: string;
  registered_at: string;
  admin_name: string | null;
  admin_email: string | null;
  password_changed_at: string | null;
  email_verified_at: string | null;
  first_login_at: string | null;
  last_login_at: string | null;
  last_seen_at: string | null;
  student_count: number;
  class_count: number;
  academic_year_count: number;
  fee_structure_count: number;
  user_count: number;
  milestones: Record<string, boolean>;
  progress_pct: number;
  setup_started: boolean;
  required_complete: boolean;
  last_activity_at: string | null;
  days_since_activity: number | null;
  status: string;
  priority: string;
};

export type SchoolDetail = {
  school: SchoolFacts;
  milestone_config: MilestoneConfig[];
  logins: { occurred_at: string; person: string | null }[];
  followups: { id: string; created_at: string; rule_key: string; kind: string; status: string; resolved_at: string | null }[];
  messages: {
    id: string;
    created_at: string;
    kind: string;
    status: string;
    subject: string;
    auto_rule: string | null;
    queued_at: string | null;
    sent_at: string | null;
    error: string | null;
  }[];
  audit: { created_at: string; event: string; actor: string; detail: Record<string, unknown> }[];
  notes: { id: string; created_at: string; kind: string; note: string; author: string | null }[];
  setup_activity?: { key: string; n: number; first_at: string | null; last_at: string | null }[];
  registered_at: string;
};

// ---------------------------------------------------------------------------------------------------------------
// Recommended next action
// ---------------------------------------------------------------------------------------------------------------

/** Required, enabled milestones that are not yet done, in configured order. */
export function missingRequired(school: Pick<SchoolFacts, "milestones">, config: MilestoneConfig[]): MilestoneConfig[] {
  return config
    .filter((m) => m.enabled && m.required && !school.milestones[m.key])
    .sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * A plain-language next step for the team. It only ever suggests a person's action or a switch that is already
 * theirs to flip: the monitor itself contacts nobody except the two approved service emails.
 */
export function recommendedNextAction(school: SchoolFacts, config: MilestoneConfig[]): string {
  const status = school.status;
  const high = school.priority === "high";
  const medium = school.priority === "medium";
  switch (status) {
    case "password_pending":
      if (high) return "Call the school administrator. The account was created more than 2 days ago and the password has still not been set.";
      if (medium) return "A password reminder is due. Send the reminder email, or call if you already know the administrator.";
      return "Wait. The school registered recently and has not yet reached the reminder time.";
    case "not_started":
      if (high) return "Call the administrator and walk them through their first sign-in. The password is set but they have not logged in.";
      if (medium) return "Send login guidance, or give the administrator a quick call.";
      return "Wait. The password was set recently; login guidance is not due yet.";
    case "logged_in_no_setup":
      return high
        ? "Offer guided onboarding. The administrator has signed in but has not started setting the school up."
        : "Give it a little time. The administrator has signed in and may be about to start setup.";
    case "setting_up": {
      const left = missingRequired(school, config);
      if (left.length === 0) return "Setup is progressing. Check in to confirm nothing is blocking them.";
      const names = left.slice(0, 3).map((m) => m.label.toLowerCase());
      return `Setup is under way (${school.progress_pct}% complete). Still to do: ${names.join(", ")}${left.length > 3 ? " and more" : ""}.`;
    }
    case "complete":
      return "No action needed. Onboarding is complete.";
    case "inactive":
      return "Call to re-engage. Ask what got in the way and whether they want a demonstration or help with setup.";
    default:
      return "No recommendation available.";
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------------------------------------------

export type TimelineEntry = {
  at: string;
  group: "account" | "login" | "setup" | "followup" | "message" | "note";
  label: string;
};

/** Every dated thing known about the school, newest first. */
export function buildTimeline(detail: SchoolDetail): TimelineEntry[] {
  const s = detail.school;
  const out: TimelineEntry[] = [];
  const add = (at: string | null | undefined, group: TimelineEntry["group"], label: string) => {
    if (at) out.push({ at, group, label });
  };

  add(s.registered_at, "account", "School registered");
  add(s.email_verified_at, "account", "Email verified");
  add(s.password_changed_at, "account", "Password changed");
  add(s.first_login_at, "login", "First login");
  for (const l of detail.logins) add(l.occurred_at, "login", l.person ? `Signed in: ${l.person}` : "Signed in");

  for (const a of detail.setup_activity ?? []) {
    if (!a.n) continue;
    const name = SETUP_LABELS[a.key] ?? a.key;
    add(a.first_at, "setup", `First ${name} added`);
    if (a.last_at && a.last_at !== a.first_at) add(a.last_at, "setup", `Latest ${name} added (${a.n} in total)`);
  }

  for (const f of detail.followups) {
    add(f.created_at, "followup", `${RULE_LABELS[f.rule_key] ?? f.rule_key} (${FOLLOWUP_STATUS_LABELS[f.status] ?? f.status})`);
  }
  for (const m of detail.messages) {
    const how = m.auto_rule ? "automatic" : "by the team";
    add(m.sent_at ?? m.queued_at ?? m.created_at, "message", `Email ${how}: ${m.status}`);
  }
  for (const n of detail.notes) add(n.created_at, "note", `Note (${NOTE_KIND_LABELS[n.kind as NoteKind] ?? n.kind})`);

  // Newest first. Events are pushed in logical order (registered, then verified, ...), so when two share a timestamp
  // (an owner's email is confirmed at registration) the later-pushed one is shown first and "School registered"
  // still ends up last.
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.at < b.e.at ? 1 : a.e.at > b.e.at ? -1 : b.i - a.i))
    .map(({ e }) => e);
}

const SETUP_LABELS: Record<string, string> = {
  academic_year: "academic year",
  classes: "class",
  students: "student",
  fee_structures: "fee structure",
};

// ---------------------------------------------------------------------------------------------------------------
// List page query string
// ---------------------------------------------------------------------------------------------------------------

export const SORTS = ["newest", "longest_inactive", "lowest_progress"] as const;
export type Sort = (typeof SORTS)[number];
export const SORT_LABELS: Record<Sort, string> = {
  newest: "Newest registration",
  longest_inactive: "Longest inactive",
  lowest_progress: "Lowest progress",
};
export const ACTIVITY_FILTERS = ["active", "quiet"] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];
export const PAGE_SIZE = 25;

export type ListParams = {
  status: OnboardingStatus | null;
  activity: ActivityFilter | null;
  from: string | null;
  to: string | null;
  q: string;
  sort: Sort;
  page: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(v: string | undefined): string | null {
  if (!v || !DATE_RE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}
function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Anything unrecognised falls back to "no filter", so a hand-edited URL can never reach the database as-is. */
export function parseListParams(raw: Record<string, string | string[] | undefined>): ListParams {
  const status = first(raw.status);
  const activity = first(raw.activity);
  const sort = first(raw.sort);
  const page = Number.parseInt(first(raw.page) ?? "1", 10);
  return {
    status: isOnboardingStatus(status) ? status : null,
    activity: (ACTIVITY_FILTERS as readonly string[]).includes(activity ?? "") ? (activity as ActivityFilter) : null,
    from: validDate(first(raw.from)),
    to: validDate(first(raw.to)),
    q: (first(raw.q) ?? "").trim().slice(0, 100),
    sort: (SORTS as readonly string[]).includes(sort ?? "") ? (sort as Sort) : "newest",
    page: Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** Builds a /admin/onboarding query string from params, omitting defaults. */
export function listHref(p: Partial<ListParams>, base = "/admin/onboarding"): string {
  const qs = new URLSearchParams();
  if (p.status) qs.set("status", p.status);
  if (p.activity) qs.set("activity", p.activity);
  if (p.from) qs.set("from", p.from);
  if (p.to) qs.set("to", p.to);
  if (p.q) qs.set("q", p.q);
  if (p.sort && p.sort !== "newest") qs.set("sort", p.sort);
  if (p.page && p.page > 1) qs.set("page", String(p.page));
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

// ---------------------------------------------------------------------------------------------------------------
// Dates (Nairobi time, like the rest of the admin console)
// ---------------------------------------------------------------------------------------------------------------

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-KE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" });
}

export function daysLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return "—";
  return days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`;
}
