// Shared between the wizard shell and the Admissions drafts list, so "step 4 of 9" on the
// draft list always means the same thing as step 4 in the wizard itself.
export interface WizardStepDef {
  id: string;
  label: string;
  note: string;
  applicableFor: (a: { boarding_preference: string | null; transport_required: boolean | null }) => boolean;
}

export const WIZARD_STEP_DEFS: WizardStepDef[] = [
  { id: "admission_details", label: "Admission Details", applicableFor: () => true, note: "Admission type, academic year, term, campus, and intended class. Built in Phase 12." },
  { id: "student", label: "Student", applicableFor: () => true, note: "Student biodata, shown for verification against the original application, plus duplicate-student detection. Built in Phase 12." },
  { id: "guardian", label: "Guardian", applicableFor: () => true, note: "Search and link an existing guardian, or create a new one. Built in Phase 12." },
  { id: "documents", label: "Documents", applicableFor: () => true, note: "Documents already submitted online, plus upload/verify/reject for anything missing. Built in Phase 12." },
  { id: "academics", label: "Academic Placement", applicableFor: () => true, note: "Class and stream placement with live capacity from Academics. Built in Phase 12." },
  { id: "boarding", label: "Boarding", applicableFor: (a) => a.boarding_preference !== "day", note: "Boarding house, dormitory, room, and bed with live availability from Boarding. Built in Phase 12." },
  { id: "transport", label: "Transport", applicableFor: (a) => a.transport_required !== false, note: "Route, pickup point, and vehicle with live capacity from Transport. Built in Phase 12." },
  { id: "health", label: "Health", applicableFor: () => true, note: "Initial health profile only — blood group, allergies, known conditions. Built in Phase 12." },
  { id: "finance", label: "Finance", applicableFor: () => true, note: "Applicable charges from fee configuration, with an option to record an initial payment. Built in Phase 12." },
  { id: "review", label: "Final Review", applicableFor: () => true, note: "Editable summary of every step before committing. Built in Phase 12." },
  { id: "complete", label: "Complete", applicableFor: () => true, note: "Complete Enrollment — creates the student record and every linked module record in one transaction. Built in Phase 12." },
];

export function applicableStepCount(a: { boarding_preference: string | null; transport_required: boolean | null }) {
  return WIZARD_STEP_DEFS.filter((s) => s.applicableFor(a)).length;
}
