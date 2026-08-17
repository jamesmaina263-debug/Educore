"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
): Promise<ActionResult> {
  const supabase = await createClient();
  const me = await currentSchoolUser(supabase);
  if (!me) return { error: "Not signed in." };

  const { data: application } = await supabase
    .from("applications")
    .select("application_number, first_name, last_name, guardian_id, school_users!applications_guardian_id_fkey(phone, full_name)")
    .eq("id", applicationId)
    .maybeSingle();
  if (!application) return { error: "Application not found." };

  const { error } = await supabase
    .from("applications")
    .update({
      status: DECISION_STATUS[decision],
      decision_by: me,
      decision_at: new Date().toISOString(),
      decision_notes: notes.trim() || null,
    })
    .eq("id", applicationId);
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

  revalidatePath("/admissions", "layout");
  return { success: true };
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
