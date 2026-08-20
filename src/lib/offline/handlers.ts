// Central dispatch table for replaying queued offline mutations.
//
// Every entry is keyed "`${module}:${type}`" and points at the exact same
// Server Action the online path calls -- so a queued-then-replayed write
// goes through identical validation, RLS, and business logic as a live one.
// There's no separate "offline write path" to keep in sync with the real
// one.
//
// To add a new module: import its action here and add one line. Nothing
// else in the offline engine (db.ts / queue.ts / use-offline-sync.ts) needs
// to change.
"use client";

import { submitAttendance } from "@/app/(app)/attendance/actions";
import { checkInStudent, checkOutStudent, administerMedication, logEmergency, createReferral } from "@/app/(app)/health/actions";

export type MutationResult = { error: string } | { success: true } | Record<string, unknown>;
export type MutationHandler = (payload: never) => Promise<MutationResult>;

// checkOutStudent takes positional args (visitId, outcome, notes) rather than
// a single typed object like every other action here -- this adapts it to
// the single-payload shape queueMutation()/syncPendingMutations() expect,
// without changing the real action's signature (which the online call site
// in sick-bay-section.tsx still calls directly, unchanged).
async function checkOutStudentMutation(payload: {
  visitId: string;
  outcome: "returned_to_class" | "sent_home" | "referred" | "collected_by_guardian";
  notes?: string;
}): Promise<MutationResult> {
  return checkOutStudent(payload.visitId, payload.outcome, payload.notes);
}

export const mutationHandlers: Record<string, MutationHandler> = {
  "attendance:submitAttendance": submitAttendance as MutationHandler,

  "health:checkInStudent": checkInStudent as MutationHandler,
  "health:checkOutStudent": checkOutStudentMutation as MutationHandler,
  "health:administerMedication": administerMedication as MutationHandler,
  "health:logEmergency": logEmergency as MutationHandler,
  "health:createReferral": createReferral as MutationHandler,
  // Deliberately not queued: updateReferralOutcome / sendHealthAlertAction
  // (delayed guardian notification timing needs its own UX, not silent
  // replay) / medical-inventory admin actions (desk-based, not field work).
  // See docs/OFFLINE_ROLLOUT.md.
};
