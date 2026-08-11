// Shared between the wizard shell and the Admissions drafts list, so "step 4 of 9" on the
// draft list always means the same thing as step 4 in the wizard itself.
export interface WizardStepDef {
  id: string;
  label: string;
  note: string;
  applicableFor: (a: { boarding_preference: string | null; transport_required: boolean | null }) => boolean;
}

export const WIZARD_STEP_DEFS: WizardStepDef[] = [
  { id: "admission_details", label: "Admission Details", applicableFor: () => true, note: "Admission type, academic year, term, and day/boarding + transport preference." },
  { id: "student", label: "Student", applicableFor: () => true, note: "Student biodata, shown for verification against the original application, plus duplicate-student detection." },
  { id: "guardian", label: "Guardian", applicableFor: () => true, note: "Search and link an existing guardian, or create a new one." },
  { id: "documents", label: "Documents", applicableFor: () => true, note: "Documents already submitted online, plus upload/verify/reject for anything missing." },
  { id: "academics", label: "Academic Placement", applicableFor: () => true, note: "Class and stream placement with live capacity from Academics." },
  { id: "boarding", label: "Boarding", applicableFor: (a) => a.boarding_preference !== "day", note: "Boarding house, dormitory, room, and bed with live availability from Boarding." },
  { id: "transport", label: "Transport", applicableFor: (a) => a.transport_required !== false, note: "Route, pickup point, and vehicle with live capacity from Transport." },
  { id: "health", label: "Health", applicableFor: () => true, note: "Initial health profile only — blood group, allergies, known conditions." },
  { id: "finance", label: "Finance", applicableFor: () => true, note: "Applicable charges from fee configuration, with an option to record an initial payment." },
  { id: "review", label: "Final Review", applicableFor: () => true, note: "Editable summary of every step before committing, plus the admission checklist. Built in Phase 13." },
  { id: "complete", label: "Complete", applicableFor: () => true, note: "Complete Enrollment — validates the checklist and finalizes the Student record, Finance invoice, and admission history in one safe, idempotent commit. Built in Phase 13." },
];

export function applicableStepCount(a: { boarding_preference: string | null; transport_required: boolean | null }) {
  return WIZARD_STEP_DEFS.filter((s) => s.applicableFor(a)).length;
}
