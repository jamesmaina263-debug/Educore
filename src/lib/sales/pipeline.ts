// Pure helpers for the platform sales pipeline (/admin/sales-pipeline). No I/O in here on
// purpose -- everything below is unit-tested in pipeline.test.ts, and the server actions and
// the client table both import the same definitions so the stage list can't drift between them.
// The stage/type/source lists must match the CHECK constraints in
// supabase/migrations/20260924130000_sales_pipeline_crm.sql.

export const STAGES = [
  { value: "new", label: "New", tone: "neutral" },
  { value: "visited", label: "Visited", tone: "info" },
  { value: "decision_maker_met", label: "Decision-maker met", tone: "info" },
  { value: "demo_booked", label: "Demo booked", tone: "warning" },
  { value: "demo_done", label: "Demo done", tone: "warning" },
  { value: "pilot", label: "Pilot", tone: "success" },
  { value: "paid", label: "Paid", tone: "success" },
  { value: "lost", label: "Lost", tone: "danger" },
] as const;

export type SalesStage = (typeof STAGES)[number]["value"];
export type StageTone = (typeof STAGES)[number]["tone"];

export const ACTIVITY_TYPES = [
  { value: "visit", label: "Visit" },
  { value: "call", label: "Call" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "demo", label: "Demo" },
  { value: "pilot_checkin", label: "Pilot check-in" },
  { value: "note", label: "Note" },
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number]["value"];

export const SOURCES = [
  { value: "door_visit", label: "Door visit" },
  { value: "referral", label: "Referral" },
  { value: "association", label: "Association / meeting" },
  { value: "inbound_web", label: "Inbound (website)" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "other", label: "Other" },
] as const;

export const SCHOOL_TYPES = [
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
  { value: "other", label: "Other" },
] as const;

const STAGE_VALUES: readonly string[] = STAGES.map((s) => s.value);
const ACTIVITY_VALUES: readonly string[] = ACTIVITY_TYPES.map((a) => a.value);
const SOURCE_VALUES: readonly string[] = SOURCES.map((s) => s.value);
const SCHOOL_TYPE_VALUES: readonly string[] = SCHOOL_TYPES.map((s) => s.value);

/** Stages where a follow-up date no longer matters. */
const CLOSED_STAGES: readonly string[] = ["paid", "lost"];

export type SalesLeadRow = {
  id: string;
  created_at: string;
  updated_at: string;
  school_name: string;
  town_county: string | null;
  school_type: string | null;
  contact_name: string | null;
  contact_role: string | null;
  phone: string | null;
  email: string | null;
  current_system: string | null;
  pain_points: string | null;
  source: string | null;
  student_count: number | null;
  stage: string;
  stage_changed_at: string;
  lost_reason: string | null;
  assigned_to: string | null;
  next_follow_up_on: string | null;
  notes: string | null;
};

export type SalesActivityRow = {
  id: string;
  lead_id: string;
  created_at: string;
  activity_type: string;
  performed_by: string | null;
  summary: string;
};

export function stageLabel(stage: string): string {
  return STAGES.find((s) => s.value === stage)?.label ?? stage;
}

export function stageTone(stage: string): StageTone {
  return STAGES.find((s) => s.value === stage)?.tone ?? "neutral";
}

export function activityLabel(type: string): string {
  if (type === "stage_change") return "Stage change";
  return ACTIVITY_TYPES.find((a) => a.value === type)?.label ?? type;
}

export function sourceLabel(source: string | null): string {
  if (!source) return "—";
  return SOURCES.find((s) => s.value === source)?.label ?? source;
}

// --- Dates -----------------------------------------------------------------------------------
// The sales team works in Kenya (EAT, UTC+3, no DST), and next_follow_up_on is a plain calendar
// date, so "today" and "this week" are computed in Africa/Nairobi rather than the server's zone.

/** Today's calendar date in Nairobi as YYYY-MM-DD. */
export function todayInNairobi(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The Monday (YYYY-MM-DD) of the week containing the given YYYY-MM-DD date. */
export function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  const back = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** ISO instant of Monday 00:00 Nairobi time for the week containing the given date. */
export function weekStartInstant(dateStr: string): string {
  return new Date(`${mondayOf(dateStr)}T00:00:00+03:00`).toISOString();
}

/**
 * Deterministic display formatting (fixed locale + Nairobi zone) so the server-rendered HTML and
 * the client render always agree -- no hydration mismatch from the viewer's locale or timezone.
 */
export function formatInstantNairobi(iso: string, withTime = false): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(new Date(iso));
}

/** Formats a plain YYYY-MM-DD calendar date without any timezone shift. */
export function formatDateOnly(dateStr: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${dateStr}T00:00:00Z`));
}

export function isFollowUpOverdue(next: string | null, stage: string, today: string): boolean {
  if (!next || CLOSED_STAGES.includes(stage)) return false;
  return next < today;
}

export function isFollowUpToday(next: string | null, stage: string, today: string): boolean {
  if (!next || CLOSED_STAGES.includes(stage)) return false;
  return next === today;
}

// --- Aggregates ------------------------------------------------------------------------------

export function funnelCounts(leads: Pick<SalesLeadRow, "stage">[]): Record<SalesStage, number> {
  const counts = Object.fromEntries(STAGES.map((s) => [s.value, 0])) as Record<SalesStage, number>;
  for (const lead of leads) {
    if (lead.stage in counts) counts[lead.stage as SalesStage] += 1;
  }
  return counts;
}

export type RepWeekSummary = { repId: string | null; visits: number; totalActivities: number };

/**
 * Per-rep activity since `sinceIso`. System-written stage_change rows are not counted as effort.
 * Activities with no rep recorded are grouped under repId null.
 */
export function weeklyActivityByRep(
  activities: Pick<SalesActivityRow, "created_at" | "activity_type" | "performed_by">[],
  sinceIso: string,
): RepWeekSummary[] {
  const since = new Date(sinceIso).getTime();
  const byRep = new Map<string | null, RepWeekSummary>();
  for (const a of activities) {
    if (a.activity_type === "stage_change") continue;
    if (new Date(a.created_at).getTime() < since) continue;
    const key = a.performed_by ?? null;
    const entry = byRep.get(key) ?? { repId: key, visits: 0, totalActivities: 0 };
    entry.totalActivities += 1;
    if (a.activity_type === "visit") entry.visits += 1;
    byRep.set(key, entry);
  }
  return [...byRep.values()].sort((a, b) => b.totalActivities - a.totalActivities);
}

// --- Validation (server-side, before the RPC) ------------------------------------------------

export type LeadInput = {
  id?: string | null;
  school_name: string;
  town_county?: string | null;
  school_type?: string | null;
  contact_name?: string | null;
  contact_role?: string | null;
  phone?: string | null;
  email?: string | null;
  current_system?: string | null;
  pain_points?: string | null;
  source?: string | null;
  student_count?: number | null;
  assigned_to?: string | null;
  next_follow_up_on?: string | null;
  notes?: string | null;
};

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isValidDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function clean(value: string | null | undefined, max: number, label: string): ValidationResult<string | null> {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return { ok: true, value: null };
  if (trimmed.length > max) return { ok: false, error: `${label} is too long (max ${max} characters).` };
  return { ok: true, value: trimmed };
}

export function validateLeadInput(input: LeadInput): ValidationResult<Required<LeadInput>> {
  const schoolName = (input.school_name ?? "").trim();
  if (schoolName === "") return { ok: false, error: "School name is required." };
  if (schoolName.length > 200) return { ok: false, error: "School name is too long (max 200 characters)." };

  const fields = [
    ["town_county", 200, "Town / county"],
    ["contact_name", 200, "Contact name"],
    ["contact_role", 100, "Contact role"],
    ["phone", 40, "Phone"],
    ["email", 254, "Email"],
    ["current_system", 200, "Current system"],
    ["pain_points", 2000, "Pain points"],
    ["notes", 4000, "Notes"],
  ] as const;

  const out: Record<string, string | number | null> = {};
  for (const [key, max, label] of fields) {
    const res = clean(input[key], max, label);
    if (!res.ok) return res;
    out[key] = res.value;
  }

  const schoolType = (input.school_type ?? "").trim();
  if (schoolType !== "" && !SCHOOL_TYPE_VALUES.includes(schoolType)) {
    return { ok: false, error: "Invalid school type." };
  }
  const source = (input.source ?? "").trim();
  if (source !== "" && !SOURCE_VALUES.includes(source)) {
    return { ok: false, error: "Invalid source." };
  }

  let studentCount: number | null = null;
  if (input.student_count !== null && input.student_count !== undefined) {
    if (!Number.isInteger(input.student_count) || input.student_count < 0 || input.student_count > 100000) {
      return { ok: false, error: "Student count must be a whole number between 0 and 100000." };
    }
    studentCount = input.student_count;
  }

  let assignedTo: string | null = null;
  if (input.assigned_to) {
    if (!isUuid(input.assigned_to)) return { ok: false, error: "Invalid rep." };
    assignedTo = input.assigned_to;
  }

  let followUp: string | null = null;
  if (input.next_follow_up_on) {
    if (!isValidDateString(input.next_follow_up_on)) return { ok: false, error: "Invalid follow-up date." };
    followUp = input.next_follow_up_on;
  }

  if (input.id && !isUuid(input.id)) return { ok: false, error: "Invalid lead id." };

  return {
    ok: true,
    value: {
      id: input.id ?? null,
      school_name: schoolName,
      town_county: out.town_county as string | null,
      school_type: schoolType === "" ? null : schoolType,
      contact_name: out.contact_name as string | null,
      contact_role: out.contact_role as string | null,
      phone: out.phone as string | null,
      email: out.email as string | null,
      current_system: out.current_system as string | null,
      pain_points: out.pain_points as string | null,
      source: source === "" ? null : source,
      student_count: studentCount,
      assigned_to: assignedTo,
      next_follow_up_on: followUp,
      notes: out.notes as string | null,
    },
  };
}

export function isValidStage(value: string): value is SalesStage {
  return STAGE_VALUES.includes(value);
}

export function isValidActivityType(value: string): value is ActivityType {
  return ACTIVITY_VALUES.includes(value);
}

// --- CSV export ------------------------------------------------------------------------------

/**
 * Neutralises spreadsheet formula injection. Reps type free text that ends up in an Excel/Sheets
 * file, and a cell starting with = + - @ (or a tab/CR) can be executed as a formula when opened.
 * Prefixing a single quote makes the spreadsheet treat it as text.
 */
export function csvSafe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function leadsToCsvRows(
  leads: SalesLeadRow[],
  repNameById: Map<string, string>,
): Record<string, string | number>[] {
  return leads.map((l) => ({
    School: csvSafe(l.school_name),
    "Town / county": csvSafe(l.town_county ?? ""),
    Type: l.school_type ?? "",
    Contact: csvSafe(l.contact_name ?? ""),
    Role: csvSafe(l.contact_role ?? ""),
    Phone: csvSafe(l.phone ?? ""),
    Email: csvSafe(l.email ?? ""),
    "Current system": csvSafe(l.current_system ?? ""),
    "Pain points": csvSafe(l.pain_points ?? ""),
    Source: sourceLabel(l.source) === "—" ? "" : sourceLabel(l.source),
    Students: l.student_count ?? "",
    Stage: stageLabel(l.stage),
    "Lost reason": csvSafe(l.lost_reason ?? ""),
    Rep: l.assigned_to ? csvSafe(repNameById.get(l.assigned_to) ?? "") : "",
    "Next follow-up": l.next_follow_up_on ?? "",
    Notes: csvSafe(l.notes ?? ""),
    Added: l.created_at.slice(0, 10),
  }));
}
