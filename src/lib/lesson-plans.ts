// Pure helpers for lesson plans linked to schemes of work (Phase 7.5).

export const LESSON_PLAN_FLAG = "feature.academics.lesson_plans";

export type LessonPlanStatus = "draft" | "ready" | "taught";

export interface LessonPlanFields {
  objectives: string;
  introduction: string;
  development: string;
  conclusion: string;
  assessment: string;
  resources: string;
  homework: string;
  reflection: string;
  durationMinutes: number | null;
  status: LessonPlanStatus;
  taughtOn: string | null;
}

export const EMPTY_PLAN: LessonPlanFields = {
  objectives: "",
  introduction: "",
  development: "",
  conclusion: "",
  assessment: "",
  resources: "",
  homework: "",
  reflection: "",
  durationMinutes: null,
  status: "draft",
  taughtOn: null,
};

const MAX_TEXT = 4000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validatePlan(input: LessonPlanFields): { error: string } | { value: LessonPlanFields } {
  const textKeys = ["objectives", "introduction", "development", "conclusion", "assessment", "resources", "homework", "reflection"] as const;
  for (const k of textKeys) {
    if (input[k].length > MAX_TEXT) return { error: `"${k}" is too long (max ${MAX_TEXT} characters).` };
  }
  if (input.durationMinutes !== null && (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 5 || input.durationMinutes > 240)) {
    return { error: "Duration must be a whole number of minutes between 5 and 240." };
  }
  if (!["draft", "ready", "taught"].includes(input.status)) return { error: "Unknown status." };
  if (input.status === "taught") {
    if (!input.taughtOn || !DATE_RE.test(input.taughtOn)) return { error: "Enter the date the lesson was taught." };
  }
  return { value: { ...input, taughtOn: input.status === "taught" ? input.taughtOn : null } };
}

export interface EntryPlanState {
  entryId: string;
  planStatus: LessonPlanStatus | null;
}

/** How many lesson rows of a scheme have a plan, and how many are ready or taught. */
export function coverage(entries: EntryPlanState[]): { total: number; planned: number; ready: number; taught: number } {
  let planned = 0;
  let ready = 0;
  let taught = 0;
  for (const e of entries) {
    if (e.planStatus === null) continue;
    planned += 1;
    if (e.planStatus === "ready") ready += 1;
    if (e.planStatus === "taught") taught += 1;
  }
  return { total: entries.length, planned, ready, taught };
}

export function statusLabel(s: LessonPlanStatus | null): string {
  if (s === null) return "No plan yet";
  return s === "draft" ? "Draft" : s === "ready" ? "Ready" : "Taught";
}
