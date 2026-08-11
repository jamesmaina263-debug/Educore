"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Recipient } from "@/app/communication/actions";

type ActionResult = { error: string } | { success: true };

// Autosave checkpoint — fires on step transitions (Next/Back), not per keystroke (Brief 4.16.11:
// "not on every keystroke"). Phase 11 only persists *which step* the officer reached; each step's
// actual field data is Phase 12's responsibility once real forms exist for Academics/Boarding/
// Transport/Health/Finance.
export async function saveWizardStep(applicationId: string, step: number): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("applications")
    .update({ wizard_current_step: step, updated_at: new Date().toISOString() })
    .eq("id", applicationId);
  if (error) return { error: error.message };
  revalidatePath("/admissions");
  revalidatePath(`/admissions/${applicationId}/wizard`);
  return { success: true };
}

export async function discardDraft(applicationId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: application } = await supabase.from("applications").select("status").eq("id", applicationId).single();
  if (!application || application.status !== "draft") {
    return { error: "Only drafts can be discarded." };
  }
  const { error } = await supabase.from("applications").delete().eq("id", applicationId);
  if (error) return { error: error.message };
  revalidatePath("/admissions");
  return { success: true };
}

// ============================================================================
// Phase 12 — Wizard Module Integration (Brief 4.16.9 steps 2–9, 4.16.16, 4.16.17)
// Every step below writes to its module's own authoritative table using the
// existing create/find-or-create logic that module already uses elsewhere —
// no shadow data lives in Admissions. See the Phase 12 migration comment for
// why the Student record is created for real at step 2 rather than deferred.
// ============================================================================

async function currentStaff(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("school_users").select("id, school_id").eq("auth_user_id", user.id).maybeSingle();
  return data;
}

// ---------- Step 1: Admission Details ----------

export interface AdmissionDetailsInput {
  admission_type: "new" | "transfer" | "re_admission";
  academic_year_id: string | null;
  term_id: string | null;
  intended_class_id: string | null;
  boarding_preference: "day" | "boarding" | null;
  transport_required: boolean;
  previous_school?: string;
  previous_class?: string;
}

export async function updateAdmissionDetails(applicationId: string, input: AdmissionDetailsInput): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("applications")
    .update({
      admission_type: input.admission_type,
      academic_year_id: input.academic_year_id,
      term_id: input.term_id,
      intended_class_id: input.intended_class_id,
      boarding_preference: input.boarding_preference,
      transport_required: input.transport_required,
      previous_school: input.previous_school || null,
      previous_class: input.previous_class || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", applicationId);
  if (error) return { error: error.message };
  revalidatePath(`/admissions/${applicationId}/wizard`);
  return { success: true };
}

// ---------- Step 2: Student Biodata + Duplicate Detection ----------

export interface DuplicateCandidate {
  id: string;
  admission_number: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  status: string;
  reason: string;
}

// Reused verbatim by the Student step before it lets the officer create a new student (Brief
// 4.16.9 step 2: "before creating a new student, check existing data... If a possible match is
// found, show 'Possible existing student found'"). Matches on name+DOB, or on a guardian phone
// this application shares with an existing student — the two identifiers the brief names.
export async function checkForDuplicateStudents(applicationId: string): Promise<{ error: string } | { success: true; candidates: DuplicateCandidate[] }> {
  const supabase = await createClient();
  const { data: application } = await supabase
    .from("applications")
    .select("first_name, last_name, date_of_birth, guardian_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (!application) return { error: "Application not found." };

  const candidates = new Map<string, DuplicateCandidate>();

  const { data: nameMatches } = await supabase
    .from("students")
    .select("id, admission_number, first_name, last_name, date_of_birth, status")
    .ilike("first_name", application.first_name)
    .ilike("last_name", application.last_name)
    .eq("date_of_birth", application.date_of_birth);
  for (const m of nameMatches ?? []) {
    candidates.set(m.id, { ...m, reason: "Same name and date of birth" });
  }

  if (application.guardian_id) {
    const { data: guardianLinks } = await supabase
      .from("student_guardians")
      .select("student_id, students(id, admission_number, first_name, last_name, date_of_birth, status)")
      .eq("guardian_user_id", application.guardian_id);
    for (const link of guardianLinks ?? []) {
      const s = link.students as unknown as { id: string; admission_number: string; first_name: string; last_name: string; date_of_birth: string; status: string } | null;
      if (!s) continue;
      const existing = candidates.get(s.id);
      candidates.set(s.id, { ...s, reason: existing ? `${existing.reason}; shares a guardian` : "Shares a guardian with this application" });
    }
  }

  return { success: true, candidates: Array.from(candidates.values()) };
}

export interface CreateOrLinkStudentInput {
  admission_number: string;
  upi_number?: string;
  override_duplicate: boolean;
  link_existing_student_id?: string;
}

export async function createOrLinkStudent(
  applicationId: string,
  input: CreateOrLinkStudentInput,
): Promise<{ error: string } | { success: true; studentId: string }> {
  const supabase = await createClient();

  const { data: application } = await supabase
    .from("applications")
    .select("school_id, first_name, last_name, other_names, date_of_birth, gender, resulting_student_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (!application) return { error: "Application not found." };

  // Already linked (e.g. officer navigated back to this step) — idempotent, don't create twice.
  if (application.resulting_student_id) {
    return { success: true, studentId: application.resulting_student_id };
  }

  if (input.link_existing_student_id) {
    const { error: linkError } = await supabase
      .from("applications")
      .update({ resulting_student_id: input.link_existing_student_id, duplicate_check_acknowledged: true, updated_at: new Date().toISOString() })
      .eq("id", applicationId);
    if (linkError) return { error: linkError.message };
    revalidatePath(`/admissions/${applicationId}/wizard`);
    return { success: true, studentId: input.link_existing_student_id };
  }

  const { data: student, error: studentError } = await supabase
    .from("students")
    .insert({
      school_id: application.school_id,
      admission_number: input.admission_number,
      upi_number: input.upi_number || null,
      first_name: application.first_name,
      last_name: application.last_name,
      other_names: application.other_names,
      date_of_birth: application.date_of_birth,
      gender: application.gender,
      // Interim status while onboarding is in progress — not yet 'enrolled'/'active'.
      // Phase 13's Complete Enrollment owns the final status flip (Brief 4.16.11).
      status: "approved",
    })
    .select("id")
    .single();
  if (studentError || !student) return { error: studentError?.message ?? "Could not create the student record." };

  const { error: updateError } = await supabase
    .from("applications")
    .update({
      resulting_student_id: student.id,
      duplicate_check_acknowledged: input.override_duplicate,
      updated_at: new Date().toISOString(),
    })
    .eq("id", applicationId);
  if (updateError) return { error: updateError.message };

  revalidatePath(`/admissions/${applicationId}/wizard`);
  revalidatePath("/students");
  return { success: true, studentId: student.id as string };
}

// ---------- Step 3: Guardian ----------

export interface GuardianSearchResult {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
}

export async function searchGuardians(query: string): Promise<{ error: string } | { success: true; results: GuardianSearchResult[] }> {
  if (query.trim().length < 2) return { success: true, results: [] };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("school_users")
    .select("id, full_name, phone, email, roles(name)")
    .eq("roles.name", "parent")
    .or(`full_name.ilike.%${query}%,phone.ilike.%${query}%`)
    .limit(10);
  if (error) return { error: error.message };
  return { success: true, results: (data ?? []).map((d) => ({ id: d.id, full_name: d.full_name, phone: d.phone, email: d.email })) };
}

export interface LinkGuardianInput {
  mode: "existing" | "new";
  guardian_id?: string;
  new_guardian?: { full_name: string; phone: string; email?: string };
  relationship: "mother" | "father" | "guardian" | "other";
  primary_contact: boolean;
}

export async function linkGuardianToApplication(applicationId: string, input: LinkGuardianInput): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: application } = await supabase.from("applications").select("resulting_student_id").eq("id", applicationId).maybeSingle();
  if (!application?.resulting_student_id) return { error: "Complete the Student step first." };

  let guardianId = input.guardian_id;
  if (input.mode === "new") {
    if (!input.new_guardian) return { error: "Guardian details are required." };
    const { findOrCreateGuardian } = await import("@/lib/guardians");
    const result = await findOrCreateGuardian(supabase, input.new_guardian);
    if ("error" in result) return { error: result.error };
    guardianId = result.id;
  }
  if (!guardianId) return { error: "Select an existing guardian or provide new guardian details." };

  const { error: appError } = await supabase.from("applications").update({ guardian_id: guardianId }).eq("id", applicationId);
  if (appError) return { error: appError.message };

  // Find-or-update, not insert-always — revisiting this step must not duplicate the link.
  const { data: existingLink } = await supabase
    .from("student_guardians")
    .select("id")
    .eq("student_id", application.resulting_student_id)
    .eq("guardian_user_id", guardianId)
    .maybeSingle();

  if (existingLink) {
    const { error } = await supabase
      .from("student_guardians")
      .update({ relationship: input.relationship, primary_contact: input.primary_contact })
      .eq("id", existingLink.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("student_guardians").insert({
      student_id: application.resulting_student_id,
      guardian_user_id: guardianId,
      relationship: input.relationship,
      primary_contact: input.primary_contact,
    });
    if (error) return { error: error.message };
  }

  revalidatePath(`/admissions/${applicationId}/wizard`);
  return { success: true };
}

// ---------- Step 4: Documents ----------
// Verify/reject reuse the exact actions the central review screen already uses (Phase 10) — the
// wizard is a second entry point onto the same document rows, not a parallel workflow. Next's
// "use server" module convention doesn't support plain re-export statements, so these thin
// wrappers just forward the call.
export async function verifyDocumentAction(documentId: string): Promise<ActionResult> {
  const { verifyDocumentAction: impl } = await import("@/app/admissions/actions");
  return impl(documentId);
}

export async function rejectDocumentAction(documentId: string, comment: string): Promise<ActionResult> {
  const { rejectDocumentAction: impl } = await import("@/app/admissions/actions");
  return impl(documentId, comment);
}

export async function uploadDocumentAsStaff(applicationId: string, category: string, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Please choose a file." };

  const { data: application } = await supabase.from("applications").select("school_id").eq("id", applicationId).maybeSingle();
  if (!application) return { error: "Application not found." };

  const staff = await currentStaff(supabase);
  const path = `${application.school_id}/${applicationId}/${category}-${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from("application-documents").upload(path, file);
  if (uploadError) return { error: uploadError.message };

  const { data: existing } = await supabase
    .from("documents")
    .select("id, storage_path")
    .eq("application_id", applicationId)
    .eq("category", category)
    .maybeSingle();
  if (existing) {
    await supabase.storage.from("application-documents").remove([existing.storage_path]);
    await supabase.from("documents").delete().eq("id", existing.id);
  }

  const { error: insertError } = await supabase.from("documents").insert({
    school_id: application.school_id,
    application_id: applicationId,
    category,
    file_name: file.name,
    storage_path: path,
    uploaded_by: staff?.id ?? null,
    verification_status: "verified", // staff-uploaded documents don't need self-verification
    verified_by: staff?.id ?? null,
    verified_at: new Date().toISOString(),
  });
  if (insertError) return { error: insertError.message };

  revalidatePath(`/admissions/${applicationId}/wizard`);
  return { success: true };
}

// ---------- Step 5: Academic Placement ----------

export async function setAcademicPlacement(applicationId: string, streamId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: application } = await supabase.from("applications").select("resulting_student_id").eq("id", applicationId).maybeSingle();
  if (!application?.resulting_student_id) return { error: "Complete the Student step first." };

  const { data: stream } = await supabase.from("streams").select("id, capacity").eq("id", streamId).maybeSingle();
  if (!stream) return { error: "Stream not found." };
  if (stream.capacity != null) {
    const { count } = await supabase.from("students").select("id", { count: "exact", head: true }).eq("current_class_id", streamId);
    if ((count ?? 0) >= stream.capacity) return { error: "This class/stream is already at capacity." };
  }

  const { error } = await supabase.from("students").update({ current_class_id: streamId }).eq("id", application.resulting_student_id);
  if (error) return { error: error.message };
  await supabase.from("applications").update({ intended_class_id: streamId }).eq("id", applicationId);

  revalidatePath(`/admissions/${applicationId}/wizard`);
  return { success: true };
}

// ---------- Step 6: Boarding ----------
// Reuses Boarding's own allocateStudentToBed (Phase 5) — same occupancy/gender validation, no
// parallel allocation logic (Brief 4.16.9 step 6: "writing to the authoritative Boarding module").
export async function allocateBoardingForApplication(applicationId: string, bedId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: application } = await supabase.from("applications").select("resulting_student_id").eq("id", applicationId).maybeSingle();
  if (!application?.resulting_student_id) return { error: "Complete the Student step first." };

  const { allocateStudentToBed } = await import("@/app/boarding/actions");
  const result = await allocateStudentToBed({ student_id: application.resulting_student_id, bed_id: bedId });
  if ("error" in result) return result;

  revalidatePath(`/admissions/${applicationId}/wizard`);
  revalidatePath("/boarding");
  return { success: true };
}

export async function removeBoardingForApplication(applicationId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: application } = await supabase.from("applications").select("resulting_student_id").eq("id", applicationId).maybeSingle();
  if (!application?.resulting_student_id) return { error: "No student linked yet." };

  const { data: allocation } = await supabase
    .from("hostel_allocations")
    .select("id")
    .eq("student_id", application.resulting_student_id)
    .eq("status", "active")
    .maybeSingle();
  if (!allocation) return { success: true };

  const { endAllocation } = await import("@/app/boarding/actions");
  const result = await endAllocation(allocation.id);
  if ("error" in result) return result;
  revalidatePath(`/admissions/${applicationId}/wizard`);
  return { success: true };
}

// ---------- Step 7: Transport ----------
export async function assignTransportForApplication(
  applicationId: string,
  input: { route_id: string; vehicle_id?: string; pickup_point?: string; stop_id?: string },
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: application } = await supabase.from("applications").select("resulting_student_id").eq("id", applicationId).maybeSingle();
  if (!application?.resulting_student_id) return { error: "Complete the Student step first." };

  const { assignTransportAction } = await import("@/app/transport/actions");
  const result = await assignTransportAction({ student_id: application.resulting_student_id, ...input });
  if ("error" in result) return result;

  revalidatePath(`/admissions/${applicationId}/wizard`);
  revalidatePath("/transport");
  return { success: true };
}

export async function removeTransportForApplication(applicationId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: application } = await supabase.from("applications").select("resulting_student_id").eq("id", applicationId).maybeSingle();
  if (!application?.resulting_student_id) return { success: true };

  const { data: assignment } = await supabase
    .from("student_transport_assignments")
    .select("id")
    .eq("student_id", application.resulting_student_id)
    .eq("status", "active")
    .maybeSingle();
  if (!assignment) return { success: true };

  const { endTransportAssignmentAction } = await import("@/app/transport/actions");
  const result = await endTransportAssignmentAction(assignment.id);
  if ("error" in result) return result;
  revalidatePath(`/admissions/${applicationId}/wizard`);
  return { success: true };
}

// ---------- Step 8: Health ----------
// Initial profile only (Brief 4.16.9 step 8) — same medical_records table Health/Students already
// use, upserted on student_id exactly like the Student profile's own Medical tab does.
export interface HealthProfileInput {
  blood_group?: string;
  allergies?: string;
  conditions?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  notes?: string;
}

export async function saveHealthProfileForApplication(applicationId: string, input: HealthProfileInput): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: application } = await supabase.from("applications").select("resulting_student_id").eq("id", applicationId).maybeSingle();
  if (!application?.resulting_student_id) return { error: "Complete the Student step first." };

  const canWrite = await supabase.rpc("auth_has_permission", { p_permission_key: "students.medical.write" });
  if (canWrite.data !== true) return { error: "You don't have permission to record medical information. A nurse or authorized staff member can complete this step." };

  const { error } = await supabase.from("medical_records").upsert(
    { student_id: application.resulting_student_id, ...input },
    { onConflict: "student_id" },
  );
  if (error) return { error: error.message };

  revalidatePath(`/admissions/${applicationId}/wizard`);
  return { success: true };
}

// ---------- Step 9: Finance ----------
// Read-only preview via the exact same resolution the Finance module's own invoicing uses
// (Phase 8's resolve_fee_charges_for_student — its own comment names this exact use case). No
// invoice is created here; that's Phase 13's Complete Enrollment. This step only stages the
// officer's initial-payment decision.
export interface FeeChargeLine {
  item_name: string;
  amount: number;
  fee_category: string;
}

export async function getFeePreview(applicationId: string): Promise<{ error: string } | { success: true; charges: FeeChargeLine[]; total: number }> {
  const supabase = await createClient();
  const { data: application } = await supabase.from("applications").select("resulting_student_id, term_id").eq("id", applicationId).maybeSingle();
  if (!application?.resulting_student_id) return { error: "Complete the Student step first." };
  if (!application.term_id) return { error: "Set the term in Admission Details first." };

  const { data, error } = await supabase.rpc("resolve_fee_charges_for_student", {
    p_student_id: application.resulting_student_id,
    p_term_id: application.term_id,
  });
  if (error) return { error: error.message };
  const charges = (data ?? []) as FeeChargeLine[];
  return { success: true, charges, total: charges.reduce((sum, c) => sum + Number(c.amount), 0) };
}

export async function saveFinanceDecision(
  applicationId: string,
  input: { initial_payment_amount: number | null; initial_payment_method: "cash" | "mpesa" | "bank" | "cheque" | null },
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("applications")
    .update({ initial_payment_amount: input.initial_payment_amount, initial_payment_method: input.initial_payment_method })
    .eq("id", applicationId);
  if (error) return { error: error.message };
  revalidatePath(`/admissions/${applicationId}/wizard`);
  return { success: true };
}

// ============================================================================
// Phase 13 — Checklist, Final Review, Complete Enrollment (Brief 4.16.10–4.16.13)
// ============================================================================

export interface ChecklistItem { item: string; message: string }

export async function getAdmissionChecklist(applicationId: string): Promise<{ error: string } | { success: true; missing: ChecklistItem[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_admission_checklist", { p_application_id: applicationId });
  if (error) return { error: error.message };
  return { success: true, missing: (data ?? []) as ChecklistItem[] };
}

export interface EnrollmentResult {
  student_id: string;
  admission_number: string;
  invoice_id: string | null;
  payment_reference: string | null;
  total_amount: number | null;
}

// Single call into the transactional SQL function (Brief 4.16.12) — the DB either commits every
// step or none of them. Idempotent: re-calling after success (double-click, slow connection)
// returns the same recorded result instead of erroring or duplicating anything.
export async function completeEnrollmentAction(applicationId: string): Promise<{ error: string } | { success: true; result: EnrollmentResult }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_enrollment", { p_application_id: applicationId }).single();
  if (error) return { error: error.message };

  // Best-effort "trigger configured communication" (Brief 4.16.11 step 15) — dispatch goes
  // through an Edge Function the SQL function can't call directly, so this happens here, and
  // never fails the enrollment itself: the completion screen's own "Send Parent Confirmation"
  // action covers this if no template is configured or the send fails.
  try {
    const { data: application } = await supabase.from("applications").select("school_id, guardian_id").eq("id", applicationId).maybeSingle();
    if (application?.guardian_id) {
      const { data: template } = await supabase
        .from("communication_templates")
        .select("id, channel")
        .eq("school_id", application.school_id)
        .ilike("category", "%admission%")
        .limit(1)
        .maybeSingle();
      if (template) {
        const { composeAndSendAction } = await import("@/app/communication/actions");
        const { data: guardian } = await supabase.from("school_users").select("phone, email").eq("id", application.guardian_id).maybeSingle();
        const { data: app2 } = await supabase.from("applications").select("resulting_student_id, first_name, last_name").eq("id", applicationId).maybeSingle();
        const recipient: Recipient = {
          phone: guardian?.phone ?? undefined,
          email: guardian?.email ?? undefined,
          student_id: app2?.resulting_student_id ?? null,
          recipient_type: "guardian",
          school_user_id: application.guardian_id,
          values: { first_name: app2?.first_name ?? "", last_name: app2?.last_name ?? "" },
        };
        await composeAndSendAction({ recipients: [recipient], template_id: template.id, channel: template.channel });
      }
    }
  } catch {
    // Non-blocking — enrollment already succeeded.
  }

  revalidatePath(`/admissions/${applicationId}/wizard`);
  revalidatePath(`/admissions/${applicationId}`);
  revalidatePath("/admissions");
  revalidatePath("/students");
  return { success: true, result: data as EnrollmentResult };
}
