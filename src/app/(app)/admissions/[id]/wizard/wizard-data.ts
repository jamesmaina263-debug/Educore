import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWizardReferenceData } from "./reference-data";
import type { AcademicYearOption, TermOption, StreamOption, HouseOption, RouteOption, VehicleOption, DocumentRequirement, ApplicationDocument } from "./step-forms";

export interface WizardStepData {
  application: {
    first_name: string;
    last_name: string;
    other_names: string | null;
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
  admissionNumber: string | null;
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
  guardian: { full_name: string; relationship: string } | null;
  financeDecision: { initial_payment_amount: number | null; initial_payment_method: string | null };
  canWriteFinance: boolean;
  mpesaActive: boolean;
  status: string;
  enrollmentResult: { student_id: string; admission_number: string; invoice_id: string | null; payment_reference: string | null; total_amount: number | null } | null;
}

export async function loadWizardStepData(supabase: SupabaseClient, applicationId: string, schoolId: string): Promise<WizardStepData> {
  const ref = await loadWizardReferenceData(supabase, schoolId);

  const [
    { data: application },
    { data: canWriteMedical },
    { data: canWriteFinance },
    { data: requirements },
    { data: mpesaSettings },
  ] = await Promise.all([
    supabase
      .from("applications")
      .select(
        "first_name, last_name, other_names, date_of_birth, gender, admission_type, academic_year_id, term_id, boarding_preference, transport_required, previous_school, previous_class, resulting_student_id, initial_payment_amount, initial_payment_method, status",
      )
      .eq("id", applicationId)
      .single(),
    supabase.rpc("auth_has_permission", { p_permission_key: "students.medical.write" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "finance.write" }),
    supabase.from("application_document_requirements").select("category, label, required").eq("school_id", schoolId).order("display_order"),
    supabase.from("mpesa_settings").select("is_active").maybeSingle(),
  ]);

  const studentId = application?.resulting_student_id ?? null;

  // Bug fix: complete_enrollment() reassigns verified documents from application_id to
  // student_id (and nulls application_id) once enrollment finishes. Filtering by
  // application_id alone made a completed admission's Documents step show everything as
  // "Not uploaded" even when it genuinely wasn't -- the rows had just moved to the student.
  const { data: documents } = studentId
    ? await supabase
        .from("documents")
        .select("id, category, file_name, verification_status, verification_comment")
        .or(`application_id.eq.${applicationId},student_id.eq.${studentId}`)
    : await supabase
        .from("documents")
        .select("id, category, file_name, verification_status, verification_comment")
        .eq("application_id", applicationId);

  let currentStreamId: string | null = null;
  let currentBedId: string | null = null;
  let hasTransportAssignment = false;
  let admissionNumber: string | null = null;
  let guardian: WizardStepData["guardian"] = null;
  let medicalRecord = { blood_group: null, allergies: null, conditions: null, emergency_contact_name: null, emergency_contact_phone: null, notes: null } as WizardStepData["medicalRecord"];

  if (studentId) {
    const [{ data: student }, { data: allocation }, { data: assignment }, { data: medical }, { data: guardianLink }] = await Promise.all([
      supabase.from("students").select("current_class_id, admission_number").eq("id", studentId).maybeSingle(),
      supabase.from("hostel_allocations").select("bed_id").eq("student_id", studentId).eq("status", "active").maybeSingle(),
      supabase.from("student_transport_assignments").select("id").eq("student_id", studentId).eq("status", "active").maybeSingle(),
      supabase.from("medical_records").select("blood_group, allergies, conditions, emergency_contact_name, emergency_contact_phone, notes").eq("student_id", studentId).maybeSingle(),
      supabase.from("student_guardians").select("relationship, school_users(full_name)").eq("student_id", studentId).eq("primary_contact", true).maybeSingle(),
    ]);
    currentStreamId = student?.current_class_id ?? null;
    admissionNumber = student?.admission_number ?? null;
    currentBedId = allocation?.bed_id ?? null;
    hasTransportAssignment = !!assignment;
    if (medical) medicalRecord = medical;
    if (guardianLink) {
      const g = guardianLink.school_users as unknown as { full_name: string } | null;
      if (g) guardian = { full_name: g.full_name, relationship: guardianLink.relationship };
    }
  }

  let enrollmentResult: WizardStepData["enrollmentResult"] = null;
  if (application?.status === "enrolled") {
    const { data: history } = await supabase
      .from("admission_enrollment_history")
      .select("student_id, admission_number, invoice_id, payment_reference")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (history) {
      const { data: invoice } = history.invoice_id
        ? await supabase.from("invoices").select("total_amount").eq("id", history.invoice_id).maybeSingle()
        : { data: null };
      enrollmentResult = { ...history, total_amount: invoice?.total_amount ?? null };
    }
  }

  return {
    application: {
      first_name: application?.first_name ?? "",
      last_name: application?.last_name ?? "",
      other_names: application?.other_names ?? null,
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
    admissionNumber,
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
    guardian,
    financeDecision: {
      initial_payment_amount: application?.initial_payment_amount ?? null,
      initial_payment_method: application?.initial_payment_method ?? null,
    },
    canWriteFinance: canWriteFinance === true,
    mpesaActive: mpesaSettings?.is_active ?? false,
    status: application?.status ?? "draft",
    enrollmentResult,
  };
}
