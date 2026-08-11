import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWizardReferenceData } from "./reference-data";
import type { AcademicYearOption, TermOption, StreamOption, HouseOption, RouteOption, VehicleOption, DocumentRequirement, ApplicationDocument } from "./step-forms";

export interface WizardStepData {
  application: {
    first_name: string;
    last_name: string;
    date_of_birth: string;
    gender: string;
    admission_type: string;
    academic_year_id: string | null;
    term_id: string | null;
    boarding_preference: string | null;
    transport_required: boolean;
    previous_school: string | null;
    previous_class: string | null;
  };
  resultingStudentId: string | null;
  academicYears: AcademicYearOption[];
  terms: TermOption[];
  streamOptions: StreamOption[];
  currentStreamId: string | null;
  houseOptions: HouseOption[];
  currentBedId: string | null;
  routeOptions: RouteOption[];
  vehicleOptions: VehicleOption[];
  hasTransportAssignment: boolean;
  documentRequirements: DocumentRequirement[];
  documents: ApplicationDocument[];
  medicalRecord: { blood_group: string | null; allergies: string | null; conditions: string | null; emergency_contact_name: string | null; emergency_contact_phone: string | null; notes: string | null };
  canWriteMedical: boolean;
  financeDecision: { initial_payment_amount: number | null; initial_payment_method: string | null };
}

export async function loadWizardStepData(supabase: SupabaseClient, applicationId: string, schoolId: string): Promise<WizardStepData> {
  const ref = await loadWizardReferenceData(supabase, schoolId);

  const [
    { data: application },
    { data: canWriteMedical },
    { data: requirements },
    { data: documents },
  ] = await Promise.all([
    supabase
      .from("applications")
      .select(
        "first_name, last_name, date_of_birth, gender, admission_type, academic_year_id, term_id, boarding_preference, transport_required, previous_school, previous_class, resulting_student_id, initial_payment_amount, initial_payment_method",
      )
      .eq("id", applicationId)
      .single(),
    supabase.rpc("auth_has_permission", { p_permission_key: "students.medical.write" }),
    supabase.from("application_document_requirements").select("category, label, required").eq("school_id", schoolId).order("display_order"),
    supabase.from("documents").select("id, category, file_name, verification_status, verification_comment").eq("application_id", applicationId),
  ]);

  const studentId = application?.resulting_student_id ?? null;

  let currentStreamId: string | null = null;
  let currentBedId: string | null = null;
  let hasTransportAssignment = false;
  let medicalRecord = { blood_group: null, allergies: null, conditions: null, emergency_contact_name: null, emergency_contact_phone: null, notes: null } as WizardStepData["medicalRecord"];

  if (studentId) {
    const [{ data: student }, { data: allocation }, { data: assignment }, { data: medical }] = await Promise.all([
      supabase.from("students").select("current_class_id").eq("id", studentId).maybeSingle(),
      supabase.from("hostel_allocations").select("bed_id").eq("student_id", studentId).eq("status", "active").maybeSingle(),
      supabase.from("student_transport_assignments").select("id").eq("student_id", studentId).eq("status", "active").maybeSingle(),
      supabase.from("medical_records").select("blood_group, allergies, conditions, emergency_contact_name, emergency_contact_phone, notes").eq("student_id", studentId).maybeSingle(),
    ]);
    currentStreamId = student?.current_class_id ?? null;
    currentBedId = allocation?.bed_id ?? null;
    hasTransportAssignment = !!assignment;
    if (medical) medicalRecord = medical;
  }

  return {
    application: {
      first_name: application?.first_name ?? "",
      last_name: application?.last_name ?? "",
      date_of_birth: application?.date_of_birth ?? "",
      gender: application?.gender ?? "",
      admission_type: application?.admission_type ?? "new",
      academic_year_id: application?.academic_year_id ?? null,
      term_id: application?.term_id ?? null,
      boarding_preference: application?.boarding_preference ?? null,
      transport_required: application?.transport_required ?? false,
      previous_school: application?.previous_school ?? null,
      previous_class: application?.previous_class ?? null,
    },
    resultingStudentId: studentId,
    academicYears: ref.academicYears,
    terms: ref.terms,
    streamOptions: ref.streamOptions,
    currentStreamId,
    houseOptions: ref.houseOptions,
    currentBedId,
    routeOptions: ref.routeOptions,
    vehicleOptions: ref.vehicleOptions,
    hasTransportAssignment,
    documentRequirements: requirements ?? [],
    documents: documents ?? [],
    medicalRecord,
    canWriteMedical: canWriteMedical === true,
    financeDecision: {
      initial_payment_amount: application?.initial_payment_amount ?? null,
      initial_payment_method: application?.initial_payment_method ?? null,
    },
  };
}
