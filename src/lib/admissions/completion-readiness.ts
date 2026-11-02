// What the admission wizard shows before "Complete Enrollment". The SQL function check_admission_checklist()
// is the single source of truth for what is missing and complete_enrollment() still enforces it; this file
// only decides how the screen reacts to the checklist's answer, so the officer is told what to fix up front
// instead of discovering it one raw database message at a time after pressing the button.

export interface ChecklistItem {
  item: string;
  message: string;
}

// Which wizard step fixes each checklist item (ids from wizard-steps.ts).
export const CHECKLIST_STEP_BY_ITEM: Record<string, string> = {
  student: "student",
  // The walk-in screening confirmation lives on the Admission Details step.
  walk_in_screening: "admission_details",
  guardian: "guardian",
  documents: "documents",
  academics: "academics",
  // The health profile has its own step. It was missing from this map, so a missing health item sent
  // the officer to the Student step instead.
  health: "health",
  finance: "finance",
  boarding: "boarding",
  transport: "transport",
};

export function stepForChecklistItem(item: string): string {
  return CHECKLIST_STEP_BY_ITEM[item] ?? "student";
}

export type ReadinessState =
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "blocked"; missing: ChecklistItem[] }
  // The check itself could not run. Completion stays possible because the server enforces the same
  // rules; the officer just doesn't get the up-front list.
  | { kind: "unknown"; error: string };

export function readinessFrom(result: { error: string } | { success: true; missing: ChecklistItem[] }): ReadinessState {
  if ("error" in result) return { kind: "unknown", error: result.error };
  return result.missing.length === 0 ? { kind: "ready" } : { kind: "blocked", missing: result.missing };
}

/** The Complete button is enabled only when nothing is missing, or when the check couldn't run (server still guards). */
export function canAttemptCompletion(state: ReadinessState): boolean {
  return state.kind === "ready" || state.kind === "unknown";
}
