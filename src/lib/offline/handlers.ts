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
import {
  updateAdmissionDetails,
  updateApplicantIdentity,
  saveHealthProfileForApplication,
  type AdmissionDetailsInput,
  type ApplicantIdentityInput,
  type HealthProfileInput,
} from "@/app/(app)/admissions/[id]/wizard/actions";
import { issueLoanAction, issueLoanToStaffAction, returnLoanAction, markLoanLostOrDamagedAction } from "@/app/(app)/library/actions";
import { recordStockMovementAction } from "@/app/(app)/inventory/actions";
import {
  createIncidentAction,
  addDisciplinaryActionAction,
  createCaseAction,
  createWelfareConcernAction,
  createSafeguardingReportAction,
} from "@/app/(app)/discipline/actions";
import { objectToFormData } from "./form-data";
import { submitStaffAttendance } from "@/app/(app)/staff/actions";
import { submitMarks, submitCompetencyMarks } from "@/app/(app)/exams/actions";
import { submitScan as submitKioskScan, type ScanPayload as KioskScanPayload, type ScanOutcome as KioskScanOutcome } from "@/lib/biometric/kiosk-client";

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

// The admissions wizard's step-save actions take (applicationId, input) --
// two args -- rather than a single object. Same adapter pattern as above.
// `base` (OS-09) is an optional snapshot of the touched fields as the form
// last loaded them, carried through unchanged so the underlying action can
// do its field-level conflict merge -- see mergeOfflineFields in actions.ts.
async function updateAdmissionDetailsMutation(payload: {
  applicationId: string;
  input: AdmissionDetailsInput;
  base?: Record<string, unknown>;
}): Promise<MutationResult> {
  return updateAdmissionDetails(payload.applicationId, payload.input, payload.base);
}

async function updateApplicantIdentityMutation(payload: {
  applicationId: string;
  input: ApplicantIdentityInput;
  base?: Record<string, unknown>;
}): Promise<MutationResult> {
  return updateApplicantIdentity(payload.applicationId, payload.input, payload.base);
}

async function saveHealthProfileForApplicationMutation(payload: {
  applicationId: string;
  input: HealthProfileInput;
  base?: Record<string, unknown>;
}): Promise<MutationResult> {
  return saveHealthProfileForApplication(payload.applicationId, payload.input, payload.base);
}

// returnLoanAction(id) takes a bare string, not an object -- same adapter
// pattern as above, just for a single positional arg.
async function returnLoanMutation(payload: { id: string }): Promise<MutationResult> {
  return returnLoanAction(payload.id);
}

// Discipline's actions all take FormData rather than a typed object -- and
// FormData itself can't be stored in IndexedDB (not structured-cloneable),
// so the UI queues a plain string map instead (see ./form-data.ts) and
// these adapters rebuild a real FormData from it before calling the actual
// action, unchanged. Only safe because none of discipline's forms have a
// file input -- verified by inspection, not assumed. If a future
// FormData-based module has file inputs, don't reuse this pattern blindly;
// see docs/OFFLINE_ROLLOUT.md.
function formDataMutation(
  action: (fd: FormData) => Promise<MutationResult>,
): (payload: Record<string, string>) => Promise<MutationResult> {
  return (payload) => action(objectToFormData(payload));
}

// The kiosk's handler is a plain fetch() against the biometric-verify Edge
// Function (see kiosk-client.ts's header comment for why this can't be a
// Server Action like every other entry here): a kiosk authenticates with a
// device key, not a Supabase Auth session, and needs to keep working long
// after any staff session that paired it has expired. Everything else
// about it -- IndexedDB storage, queuing, per-module scoping, retry-on-
// reconnect -- is the same shared engine every other module uses, unchanged.
async function submitKioskScanMutation(payload: KioskScanPayload): Promise<MutationResult> {
  const result: KioskScanOutcome = await submitKioskScan(payload);
  if ("error" in result) return { error: result.error };
  return result;
}

export const mutationHandlers: Record<string, MutationHandler> = {
  "attendance:submitAttendance": submitAttendance as MutationHandler,

  "biometric-kiosk:submitScan": submitKioskScanMutation as MutationHandler,
  // Deliberately the ONLY biometric-kiosk entry: enrollment, device
  // registration, and roster management are all desk-based admin actions
  // performed by a logged-in staff member with a real session -- exactly
  // the category excluded everywhere else in this table (see the other
  // "Deliberately not queued" notes). The gate scan itself is the only
  // kiosk-side action that happens unattended, away from reliable Wi-Fi.

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

  // Admissions is structurally different from the modules above: the wizard
  // is a live, sequential flow (duplicate detection, guardian search, fee
  // calculation, a final enrollment-commit step) that genuinely needs a
  // connection to progress safely. Only the plain field-save steps that
  // don't depend on a live server computation are queued here -- everything
  // else (checkForDuplicateStudents, createOrLinkStudent, searchGuardians,
  // linkGuardianToApplication, document upload, boarding/transport
  // assignment, getFeePreview, saveFinanceDecision, completeEnrollmentAction)
  // stays online-only. See docs/OFFLINE_ROLLOUT.md for the full reasoning.
  "admissions:updateAdmissionDetails": updateAdmissionDetailsMutation as MutationHandler,
  "admissions:updateApplicantIdentity": updateApplicantIdentityMutation as MutationHandler,
  "admissions:saveHealthProfileForApplication": saveHealthProfileForApplicationMutation as MutationHandler,

  "library:issueLoanAction": issueLoanAction as MutationHandler,
  "library:issueLoanToStaffAction": issueLoanToStaffAction as MutationHandler,
  "library:returnLoanAction": returnLoanMutation as MutationHandler,
  "library:markLoanLostOrDamagedAction": markLoanLostOrDamagedAction as MutationHandler,
  // Deliberately not queued: createLibraryItemAction / adjustCopiesAction
  // (desk cataloguing), createShelfAction / createReservationAction /
  // createFineAction (FormData), cancelReservationAction /
  // resolveFineAction (desk follow-up). See docs/OFFLINE_ROLLOUT.md.

  "inventory:recordStockMovementAction": recordStockMovementAction as MutationHandler,
  // Deliberately not queued: createInventoryItemAction / createCategoryAction
  // (desk cataloguing), createTransferAction (desk-initiated, like boarding's
  // transferStudent), everything asset/procurement-related (FormData, and
  // desk/office workflows). See docs/OFFLINE_ROLLOUT.md.

  "discipline:createIncidentAction": formDataMutation(createIncidentAction) as MutationHandler,
  "discipline:addDisciplinaryActionAction": formDataMutation(addDisciplinaryActionAction) as MutationHandler,
  "discipline:createCaseAction": formDataMutation(createCaseAction) as MutationHandler,
  "discipline:createWelfareConcernAction": formDataMutation(createWelfareConcernAction) as MutationHandler,
  "discipline:createSafeguardingReportAction": formDataMutation(createSafeguardingReportAction) as MutationHandler,
  // Deliberately not queued: updateCaseAction / updateWelfareConcernAction /
  // updateSafeguardingReportAction -- status/follow-up updates, desk-based
  // like updateReferralOutcome and updateIncidentStatus elsewhere in this
  // rollout. See docs/OFFLINE_ROLLOUT.md.

  "staff-attendance:submitStaffAttendance": submitStaffAttendance as MutationHandler,
  // Transport was audited and has nothing to queue -- every one of its 5
  // actions is desk/office setup or assignment work, not field activity.
  // editStaffAttendanceRecord is deliberately not queued -- a correction,
  // desk follow-up like every other *record/*Status update excluded
  // elsewhere. See docs/OFFLINE_ROLLOUT.md.

  "exams:submitMarks": submitMarks as MutationHandler,
  "exams:submitCompetencyMarks": submitCompetencyMarks as MutationHandler,
  // Deliberately not queued: editMark / editCompetencyMark (corrections --
  // desk follow-up, same category as editAttendanceRecord /
  // updateReferralOutcome / updateIncidentStatus elsewhere in this rollout),
  // and the exam/grading-scale/schedule/curriculum-strand setup actions
  // (desk-based admin, not the classroom/exam-hall marks entry the two
  // handlers above cover). See docs/OFFLINE_ROLLOUT.md.
};
