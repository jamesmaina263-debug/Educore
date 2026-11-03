// Staff training records and expiry roll-up (WP 7.3). Pure helpers shared by the page, the server
// actions and tests. The database functions (save_staff_training_record, staff_expiry_overview, ...)
// re-check everything here; this file only gives people a clear message before a round trip.

export const TRAINING_FLAG = "feature.hr.staff_training";

export const TRAINING_CATEGORIES = ["cpd", "induction", "safeguarding", "first_aid", "subject", "leadership", "compliance", "other"] as const;
export type TrainingCategory = (typeof TRAINING_CATEGORIES)[number];
export type TrainingStatus = "planned" | "completed" | "cancelled";

export const CATEGORY_LABELS: Record<TrainingCategory, string> = {
  cpd: "CPD",
  induction: "Induction",
  safeguarding: "Safeguarding",
  first_aid: "First aid",
  subject: "Subject training",
  leadership: "Leadership",
  compliance: "Compliance",
  other: "Other",
};

export const WINDOW_OPTIONS = [30, 60, 90, 180, 365] as const;
export const DEFAULT_WINDOW = 90;

export interface TrainingInput {
  id: string | null;
  staffId: string;
  title: string;
  provider: string;
  category: TrainingCategory;
  status: "planned" | "completed";
  startDate: string; // YYYY-MM-DD
  endDate: string; // "" when not set
  hours: string; // "" when not set
  expiresOn: string; // "" when not set
  notes: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function validateTraining(input: TrainingInput): { error: string } | { value: TrainingInput; hours: number | null } {
  const title = input.title.trim();
  if (!input.staffId) return { error: "Choose a staff member." };
  if (title.length < 1 || title.length > 150) return { error: "Give the training a title (up to 150 characters)." };
  if (!TRAINING_CATEGORIES.includes(input.category)) return { error: "Choose a category." };
  if (input.status !== "planned" && input.status !== "completed") return { error: "Choose planned or completed." };
  if (!isRealDate(input.startDate)) return { error: "Enter a valid start date." };
  if (input.endDate && !isRealDate(input.endDate)) return { error: "Enter a valid end date." };
  if (input.endDate && input.endDate < input.startDate) return { error: "The end date cannot be before the start date." };
  if (input.expiresOn && !isRealDate(input.expiresOn)) return { error: "Enter a valid expiry date." };
  if (input.expiresOn && input.expiresOn < input.startDate) return { error: "The expiry date cannot be before the start date." };
  if (input.provider.length > 150) return { error: "The provider name is too long (150 characters at most)." };
  if (input.notes.length > 1000) return { error: "The notes are too long (1000 characters at most)." };
  let hours: number | null = null;
  if (input.hours.trim() !== "") {
    const h = Number(input.hours);
    if (!Number.isFinite(h) || h < 0 || h > 1000) return { error: "Hours must be a number from 0 to 1000." };
    hours = Math.round(h * 10) / 10;
  }
  return { value: { ...input, title }, hours };
}

export type OverviewKind = "contract" | "qualification" | "training";

export interface OverviewRow {
  kind: OverviewKind;
  staffId: string;
  staffName: string;
  label: string;
  dueDate: string;
  daysLeft: number;
}

export const KIND_LABELS: Record<OverviewKind, string> = {
  contract: "Contract",
  qualification: "Qualification",
  training: "Training",
};

/** "Overdue by 3 days", "Due today", "In 12 days". */
export function dueLabel(daysLeft: number): string {
  if (daysLeft < 0) return `Overdue by ${-daysLeft} day${daysLeft === -1 ? "" : "s"}`;
  if (daysLeft === 0) return "Due today";
  return `In ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
}

export type Urgency = "overdue" | "soon" | "later";

/** Overdue is past; soon is within 14 days; everything else in the window is later. */
export function urgency(daysLeft: number): Urgency {
  if (daysLeft < 0) return "overdue";
  if (daysLeft <= 14) return "soon";
  return "later";
}

export function parseWindow(raw: string | undefined): number {
  const n = Number(raw);
  return (WINDOW_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_WINDOW;
}

export function overviewCounts(rows: OverviewRow[]): { overdue: number; soon: number; later: number } {
  const c = { overdue: 0, soon: 0, later: 0 };
  for (const r of rows) c[urgency(r.daysLeft)] += 1;
  return c;
}

export interface TrainingRecord {
  id: string;
  staffId: string;
  staffName: string;
  title: string;
  provider: string | null;
  category: TrainingCategory;
  status: TrainingStatus;
  startDate: string;
  endDate: string | null;
  hours: number | null;
  expiresOn: string | null;
  notes: string | null;
}

export function formatDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] ?? "?";
  return `${day} ${mon} ${y}`;
}

/** Newest first; cancelled records sink to the bottom. */
export function sortRecords(records: TrainingRecord[]): TrainingRecord[] {
  return [...records].sort((a, b) => {
    const ac = a.status === "cancelled" ? 1 : 0;
    const bc = b.status === "cancelled" ? 1 : 0;
    return ac - bc || b.startDate.localeCompare(a.startDate) || a.staffName.localeCompare(b.staffName);
  });
}
