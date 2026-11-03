// Recruitment pipeline (WP 7.1). Pure helpers shared by the page, the server actions and tests.
// The database functions (save_recruitment_opening, add_recruitment_candidate, ...) re-check every
// rule here; this file only gives people a clear message before a round trip. Nothing here sends a
// message: marking someone "hired" is a record only.

export const RECRUITMENT_FLAG = "feature.hr.recruitment";

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "temporary"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  temporary: "Temporary",
};

export const OPENING_STATUSES = ["draft", "open", "closed", "filled", "cancelled"] as const;
export type OpeningStatus = (typeof OPENING_STATUSES)[number];
export const OPENING_STATUS_LABELS: Record<OpeningStatus, string> = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
  filled: "Filled",
  cancelled: "Cancelled",
};

export const STAGES = ["applied", "shortlisted", "interview", "offer", "hired", "rejected", "withdrawn"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  applied: "Applied",
  shortlisted: "Shortlisted",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

/** Same table as move_recruitment_candidate(): one step forward, or out from any live stage. */
export const NEXT_STAGES: Record<Stage, Stage[]> = {
  applied: ["shortlisted", "rejected", "withdrawn"],
  shortlisted: ["interview", "rejected", "withdrawn"],
  interview: ["offer", "rejected", "withdrawn"],
  offer: ["hired", "rejected", "withdrawn"],
  hired: [],
  rejected: [],
  withdrawn: [],
};

export const LIVE_STAGES: Stage[] = ["applied", "shortlisted", "interview", "offer"];

export function canMove(from: Stage, to: Stage): boolean {
  return NEXT_STAGES[from].includes(to);
}

export interface OpeningInput {
  id: string | null;
  title: string;
  department: string;
  employmentType: EmploymentType;
  description: string;
  positions: number;
  closesOn: string; // YYYY-MM-DD or ""
  status: OpeningStatus;
}

export function validateOpening(i: OpeningInput): { error: string } | { value: OpeningInput } {
  const title = i.title.trim();
  if (title.length < 1 || title.length > 150) return { error: "Give the opening a title (150 characters at most)." };
  if (i.department.length > 100) return { error: "The department is too long (100 characters at most)." };
  if (i.description.length > 4000) return { error: "The description is too long (4000 characters at most)." };
  if (!EMPLOYMENT_TYPES.includes(i.employmentType)) return { error: "Choose an employment type." };
  if (!OPENING_STATUSES.includes(i.status)) return { error: "Choose a status." };
  if (!Number.isInteger(i.positions) || i.positions < 1 || i.positions > 100) return { error: "Positions must be a whole number from 1 to 100." };
  if (i.closesOn && !/^\d{4}-\d{2}-\d{2}$/.test(i.closesOn)) return { error: "Enter the closing date as a valid date." };
  return { value: { ...i, title } };
}

export interface CandidateInput {
  openingId: string;
  fullName: string;
  email: string;
  phone: string;
  source: string;
}

export function validateCandidate(i: CandidateInput): { error: string } | { value: CandidateInput } {
  const fullName = i.fullName.trim();
  const email = i.email.trim();
  if (!i.openingId) return { error: "Choose an opening first." };
  if (fullName.length < 1 || fullName.length > 120) return { error: "Enter the candidate's name (120 characters at most)." };
  if (email && (email.length > 200 || !/^[^\s@]+@[^\s@]+$/.test(email))) return { error: "That email address does not look right." };
  if (i.phone.length > 30) return { error: "The phone number is too long (30 characters at most)." };
  if (i.source.length > 100) return { error: "The source is too long (100 characters at most)." };
  return { value: { ...i, fullName, email } };
}

/** A rejection must say why; other moves may carry an optional note. */
export function validateMove(from: Stage, to: Stage, note: string): { error: string } | { ok: true } {
  if (!canMove(from, to)) return { error: `A candidate cannot move from ${STAGE_LABELS[from]} to ${STAGE_LABELS[to]}.` };
  if (to === "rejected" && note.trim().length === 0) return { error: "Give a reason when rejecting a candidate." };
  if (note.length > 2000) return { error: "The note is too long (2000 characters at most)." };
  return { ok: true };
}

export interface CandidateLite {
  id: string;
  openingId: string;
  stage: Stage;
}

export function countByStage(candidates: CandidateLite[]): Record<Stage, number> {
  const out = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const c of candidates) out[c.stage] += 1;
  return out;
}

export interface OpeningProgress {
  total: number;
  live: number;
  hired: number;
  positions: number;
  /** Hires have reached the number of positions. */
  complete: boolean;
}

export function openingProgress(positions: number, candidates: CandidateLite[]): OpeningProgress {
  const counts = countByStage(candidates);
  const live = LIVE_STAGES.reduce((n, s) => n + counts[s], 0);
  return { total: candidates.length, live, hired: counts.hired, positions, complete: counts.hired >= positions };
}

export function isClosingSoon(closesOn: string | null, status: OpeningStatus, today: string, days = 7): boolean {
  if (status !== "open" || !closesOn) return false;
  const diff = (Date.parse(closesOn) - Date.parse(today)) / 86_400_000;
  return diff >= 0 && diff <= days;
}

export function isPastClosing(closesOn: string | null, status: OpeningStatus, today: string): boolean {
  return status === "open" && !!closesOn && closesOn < today;
}
