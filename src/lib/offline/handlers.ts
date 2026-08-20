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
import { submitRollCall, logIncident } from "@/app/(app)/boarding/actions";

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

// Same adapter pattern for submitRollCall(date, session, entries).
async function submitRollCallMutation(payload: {
  date: string;
  session: "boarding_am" | "boarding_pm";
  entries: { student_id: string; stream_id: string; status: "present" | "absent" | "sick_bay" | "excused" | "late" }[];
}): Promise<MutationResult> {
  return submitRollCall(payload.date, payload.session, payload.entries);
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

  "boarding:submitRollCall": submitRollCallMutation as MutationHandler,
  "boarding:logIncident": logIncident as MutationHandler,
  // Deliberately not queued: house/dormitory/room/bed structure setup,
  // allocateStudentToBed / endAllocation / transferStudent, and
  // updateIncidentStatus -- all desk-based admin actions, not the
  // dorm-floor, possibly-no-signal work roll call and incident logging are.
  // See docs/OFFLINE_ROLLOUT.md.
};
