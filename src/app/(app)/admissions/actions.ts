"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mergeAdmissionFormTemplate } from "@/lib/admission-form-merge";

type ActionResult = { error: string } | { success: true };

async function currentSchoolUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("school_users").select("id").eq("auth_user_id", user.id).maybeSingle();
  return data?.id ?? null;
}

export async function markUnderReviewAction(applicationId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("applications")
    .update({ status: "under_review" })
    .eq("id", applicationId)
    .eq("status", "submitted"); // only advance from submitted — don't clobber a further-along status
  if (error) return { error: error.message };
  revalidatePath("/admissions");
  revalidatePath(`/admissions/${applicationId}`);
  return { success: true };
}

export async function verifyDocumentAction(documentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const me = await currentSchoolUser(supabase);
  if (!me) return { error: "Not signed in." };

  const { error } = await supabase
    .from("documents")
    .update({ verification_status: "verified", verification_comment: null, verified_by: me, verified_at: new Date().toISOString() })
    .eq("id", documentId);
  if (error) return { error: error.message };
  revalidatePath("/admissions", "layout");
  return { success: true };
}

export async function rejectDocumentAction(documentId: string, comment: string): Promise<ActionResult> {
  if (!comment.trim()) return { error: "Please explain why the document is being rejected." };
  const supabase = await createClient();
  const me = await currentSchoolUser(supabase);
  if (!me) return { error: "Not signed in." };

  const { error } = await supabase
    .from("documents")
    .update({ verification_status: "rejected", verification_comment: comment.trim(), verified_by: me, verified_at: new Date().toISOString() })
    .eq("id", documentId);
  if (error) return { error: error.message };
  revalidatePath("/admissions", "layout");
  return { success: true };
}

export async function requestDocumentAction(applicationId: string, categoryLabel: string): Promise<ActionResult> {
  const supabase = await createClient();

  const { data: application } = await supabase
    .from("applications")
    .select("application_number, first_name, last_name, school_id, guardian_id, school_users!applications_guardian_id_fkey(phone, full_name)")
    .eq("id", applicationId)
    .maybeSingle();
  if (!application) return { error: "Application not found." };

  const { error } = await supabase.from("applications").update({ status: "documents_required" }).eq("id", applicationId);
  if (error) return { error: error.message };

  const guardian = application.school_users as unknown as { phone: string | null; full_name: string } | null;
  if (guardian?.phone) {
    const { error: notifyError } = await supabase.rpc("queue_communication", {
      p_recipients: [{ phone: guardian.phone, values: {} }],
      p_body: `Hi ${guardian.full_name}, we need "${categoryLabel}" for ${application.first_name} ${application.last_name}'s application (Ref: ${application.application_number}). Please upload it using your status link.`,
      p_channel: "sms",
    });
    // Non-fatal — the status change is what matters most; the notification is best-effort.
    if (notifyError) console.error("requestDocumentAction notify failed:", notifyError.message);
  }

  revalidatePath("/admissions", "layout");
  return { success: true };
}

export async function scheduleInterviewAction(applicationId: string, interviewDate: string): Promise<ActionResult> {
  const supabase = await createClient();
  const me = await currentSchoolUser(supabase);
  if (!me) return { error: "Not signed in." };

  const { error } = await supabase
    .from("applications")
    .update({ status: "interview_scheduled", interview_date: interviewDate, interviewer_id: me })
    .eq("id", applicationId);
  if (error) return { error: error.message };
  revalidatePath("/admissions", "layout");
  return { success: true };
}

export async function recordAssessmentAction(
  applicationId: string,
  input: { assessment_type: string; assessment_subject: string; assessment_score: number | null; assessment_comments: string },
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("applications")
    .update({
      status: "under_review",
      assessment_date: new Date().toISOString().slice(0, 10),
      assessment_type: input.assessment_type || null,
      assessment_subject: input.assessment_subject || null,
      assessment_score: input.assessment_score,
      assessment_comments: input.assessment_comments || null,
    })
    .eq("id", applicationId);
  if (error) return { error: error.message };
  revalidatePath("/admissions", "layout");
  return { success: true };
}

const DECISION_STATUS = {
  accept: "admission_pending",
  conditionally_accept: "conditionally_accepted",
  waitlist: "waitlisted",
  reject: "rejected",
} as const;

export async function decideApplicationAction(
  applicationId: string,
  decision: keyof typeof DECISION_STATUS,
  notes: string,
  admissionDetails?: { term_id: string; intended_class_id: string },
): Promise<ActionResult> {
  const supabase = await createClient();
  const me = await currentSchoolUser(supabase);
  if (!me) return { error: "Not signed in." };

  const { data: application } = await supabase
    .from("applications")
    .select(
      "application_number, first_name, last_name, guardian_id, school_id, application_source, boarding_preference, transport_required, school_users!applications_guardian_id_fkey(phone, full_name)",
    )
    .eq("id", applicationId)
    .maybeSingle();
  if (!application) return { error: "Application not found." };

  // The fee structure is already known and already committed to well before this point for an
  // online applicant (that's the whole reason for sending it in the acceptance email) — so
  // accepting one requires nailing down term + class right here, rather than leaving it to
  // whenever an officer eventually opens the wizard.
  if (decision === "accept" && application.application_source === "online") {
    if (!admissionDetails?.term_id || !admissionDetails?.intended_class_id) {
      return { error: "Select a term and class before accepting an online application." };
    }
  }

  const updatePayload: Record<string, unknown> = {
    status: DECISION_STATUS[decision],
    decision_by: me,
    decision_at: new Date().toISOString(),
    decision_notes: notes.trim() || null,
  };
  if (decision === "accept" && admissionDetails?.term_id && admissionDetails?.intended_class_id) {
    updatePayload.term_id = admissionDetails.term_id;
    updatePayload.intended_class_id = admissionDetails.intended_class_id;
  }

  const { error } = await supabase.from("applications").update(updatePayload).eq("id", applicationId);
  if (error) return { error: error.message };

  const guardian = application.school_users as unknown as { phone: string | null; full_name: string } | null;
  const DECISION_MESSAGE: Record<keyof typeof DECISION_STATUS, string> = {
    accept: `Congratulations! ${application.first_name} ${application.last_name}'s application (Ref: ${application.application_number}) has been accepted. The school will be in touch about next steps.`,
    conditionally_accept: `${application.first_name} ${application.last_name}'s application (Ref: ${application.application_number}) has been conditionally accepted. The school will explain the conditions.`,
    waitlist: `${application.first_name} ${application.last_name}'s application (Ref: ${application.application_number}) has been waitlisted. We'll contact you if a place becomes available.`,
    reject: `We regret to inform you that ${application.first_name} ${application.last_name}'s application (Ref: ${application.application_number}) was not successful this time.`,
  };
  if (guardian?.phone) {
    const { error: notifyError } = await supabase.rpc("queue_communication", {
      p_recipients: [{ phone: guardian.phone, values: {} }],
      p_body: DECISION_MESSAGE[decision],
      p_channel: "sms",
    });
    if (notifyError) console.error("decideApplicationAction notify failed:", notifyError.message);
  }

  if (decision === "accept" && application.application_source === "online" && admissionDetails?.term_id && admissionDetails?.intended_class_id) {
    try {
      await sendAdmissionFormEmail(supabase, {
        applicationId,
        schoolId: application.school_id,
        termId: admissionDetails.term_id,
        streamId: admissionDetails.intended_class_id,
        studentName: `${application.first_name} ${application.last_name}`,
        guardianName: guardian?.full_name ?? "Parent/Guardian",
        applicationNumber: application.application_number,
        isBoarder: application.boarding_preference === "boarding",
        needsTransport: application.transport_required === true,
      });
    } catch (formError) {
      // Best-effort, matching every other notification in this codebase — a template/merge
      // problem shouldn't block the acceptance itself, which has already been recorded above.
      console.error("decideApplicationAction admission-form email failed:", formError);
    }
  }

  revalidatePath("/admissions", "layout");
  return { success: true };
}

// Fills the school's own uploaded template (if they've uploaded one) with this applicant's real
// details and fee structure, then queues it as an email attachment. No-ops quietly if the
// school hasn't configured a template yet — accepting an application should never depend on it.
async function sendAdmissionFormEmail(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    applicationId: string;
    schoolId: string;
    termId: string;
    streamId: string;
    studentName: string;
    guardianName: string;
    applicationNumber: string;
    isBoarder: boolean;
    needsTransport: boolean;
  },
) {
  const { data: template } = await supabase
    .from("admission_form_templates")
    .select("storage_path, original_filename")
    .eq("school_id", input.schoolId)
    .maybeSingle();
  if (!template) return; // nothing configured — nothing to do

  const [{ data: schoolRow }, { data: streamRow }, { data: termRow }] = await Promise.all([
    supabase.from("schools").select("name").eq("id", input.schoolId).maybeSingle(),
    supabase.from("streams").select("name, class_id, classes(name)").eq("id", input.streamId).maybeSingle(),
    supabase.from("terms").select("name, academic_years(name)").eq("id", input.termId).maybeSingle(),
  ]);
  if (!streamRow?.class_id) return;

  const { data: realFeeItems, error: realFeeError } = await supabase.rpc("preview_fee_structure_for_class", {
    p_school_id: input.schoolId,
    p_term_id: input.termId,
    p_class_id: streamRow.class_id,
    p_is_boarder: input.isBoarder,
    p_needs_transport: input.needsTransport,
  });
  if (realFeeError) throw new Error(realFeeError.message);

  const items = (realFeeItems ?? []) as { item_name: string; amount: number }[];
  const total = items.reduce((sum, i) => sum + Number(i.amount), 0);
  const className = (streamRow.classes as unknown as { name: string } | null)?.name ?? "";
  const streamLabel = streamRow.name ? `${className} ${streamRow.name}`.trim() : className;
  const termLabel = termRow?.name ?? "";
  const yearLabel = (termRow?.academic_years as unknown as { name: string } | null)?.name ?? "";

  const { data: templateFile, error: downloadError } = await supabase.storage
    .from("admission-form-templates")
    .download(template.storage_path);
  if (downloadError || !templateFile) throw new Error(downloadError?.message ?? "Could not download the school's admission form template.");

  const templateBytes = await templateFile.arrayBuffer();
  const merged = mergeAdmissionFormTemplate(templateBytes, {
    student_name: input.studentName,
    guardian_name: input.guardianName,
    class_name: streamLabel,
    term_name: termLabel,
    academic_year: yearLabel,
    school_name: schoolRow?.name ?? "",
    application_number: input.applicationNumber,
    date: new Date().toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" }),
    fee_items: items.map((i) => `${i.item_name}: KES ${Number(i.amount).toLocaleString()}`).join("\n"),
    fee_total: `KES ${total.toLocaleString()}`,
  });

  const filename = `admission-form-${input.applicationNumber}.docx`;
  const path = `${input.schoolId}/${input.applicationId}/admission-form-${Date.now()}.docx`;
  const { error: uploadError } = await supabase.storage
    .from("application-documents")
    .upload(path, merged, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  if (uploadError) throw new Error(uploadError.message);

  const subject = `Admission Offer — ${input.studentName}`;
  const body =
    `Dear ${input.guardianName},\n\n` +
    `We're pleased to confirm ${input.studentName}'s admission offer for ${streamLabel}, ${termLabel} ${yearLabel}.\n\n` +
    `Please find the admission form attached, including the applicable fee structure. Total: KES ${total.toLocaleString()}.\n\n` +
    `Reference: ${input.applicationNumber}`;

  const { error: queueError } = await supabase.rpc("queue_admission_form_email", {
    p_application_id: input.applicationId,
    p_subject: subject,
    p_body: body,
    p_attachment_storage_path: path,
    p_attachment_filename: filename,
  });
  if (queueError) throw new Error(queueError.message);
}

export async function markConditionsMetAction(applicationId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("applications")
    .update({ status: "admission_pending" })
    .eq("id", applicationId)
    .eq("status", "conditionally_accepted");
  if (error) return { error: error.message };
  revalidatePath("/admissions", "layout");
  return { success: true };
}

// Only ever callable for draft/rejected/withdrawn applications -- delete_application_permanently()
// itself refuses anything further along the pipeline, so this can't be used to erase a live or
// admitted record even if called with a stale/wrong id. Storage objects aren't reachable from SQL,
// so the actual file removal happens here, before the RPC deletes the DB rows (which cascade the
// documents rows themselves).
export async function deleteApplicationPermanentlyAction(applicationId: string): Promise<ActionResult> {
  const supabase = await createClient();

  const { data: docs } = await supabase.from("documents").select("storage_path").eq("application_id", applicationId);
  const paths = (docs ?? []).map((d) => d.storage_path).filter((p): p is string => !!p);
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from("application-documents").remove(paths);
    // Non-fatal -- an orphaned storage object is a cleanup nuisance, not a reason to block the
    // person from clearing the record itself. Still delete the DB rows below.
    if (storageError) console.error("deleteApplicationPermanentlyAction storage cleanup failed:", storageError.message);
  }

  const { error } = await supabase.rpc("delete_application_permanently", { p_application_id: applicationId });
  if (error) return { error: error.message };
  revalidatePath("/admissions", "layout");
  return { success: true };
}
