"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export interface ApplicationStatusData {
  application_number: string;
  status: string;
  first_name: string;
  last_name: string;
  school_name: string;
  submitted_at: string | null;
  decision_notes: string | null;
  requirements: {
    category: string;
    label: string;
    required: boolean;
    document: { id: string; file_name: string; verification_status: string; verification_comment: string | null } | null;
  }[];
}

export async function getApplicationByToken(
  token: string,
): Promise<{ error: string } | { success: true; data: ApplicationStatusData }> {
  const admin = createAdminClient();

  const { data: application } = await admin
    .from("applications")
    .select("id, school_id, application_number, status, first_name, last_name, submitted_at, decision_notes, resulting_student_id, schools(name)")
    .eq("access_token", token)
    .maybeSingle();
  if (!application) return { error: "We couldn't find an application with this link." };

  // Bug fix: complete_enrollment() reassigns verified documents from application_id to
  // student_id (and nulls application_id) once enrollment finishes. Filtering by
  // application_id alone made a parent's status page show every document as "Not uploaded"
  // once their child was actually enrolled -- the rows had just moved to the student.
  const [{ data: requirements }, { data: documents }] = await Promise.all([
    admin
      .from("application_document_requirements")
      .select("category, label, required")
      .eq("school_id", application.school_id)
      .order("display_order"),
    application.resulting_student_id
      ? admin
          .from("documents")
          .select("id, category, file_name, verification_status, verification_comment")
          .or(`application_id.eq.${application.id},student_id.eq.${application.resulting_student_id}`)
      : admin
          .from("documents")
          .select("id, category, file_name, verification_status, verification_comment")
          .eq("application_id", application.id),
  ]);

  const docsByCategory = new Map((documents ?? []).map((d) => [d.category, d]));

  return {
    success: true,
    data: {
      application_number: application.application_number,
      status: application.status,
      first_name: application.first_name,
      last_name: application.last_name,
      school_name: (application.schools as unknown as { name: string } | null)?.name ?? "",
      submitted_at: application.submitted_at,
      decision_notes: application.decision_notes,
      requirements: (requirements ?? []).map((r) => ({
        category: r.category,
        label: r.label,
        required: r.required,
        document: docsByCategory.get(r.category)
          ? {
              id: docsByCategory.get(r.category)!.id,
              file_name: docsByCategory.get(r.category)!.file_name,
              verification_status: docsByCategory.get(r.category)!.verification_status,
              verification_comment: docsByCategory.get(r.category)!.verification_comment,
            }
          : null,
      })),
    },
  };
}

export async function uploadStatusDocument(
  token: string,
  category: string,
  formData: FormData,
): Promise<{ error: string } | { success: true }> {
  const admin = createAdminClient();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Please choose a file." };

  const { data: application } = await admin
    .from("applications")
    .select("id, school_id, status, guardian_id")
    .eq("access_token", token)
    .maybeSingle();
  if (!application) return { error: "We couldn't find an application with this link." };

  // documents.uploaded_by is NOT NULL. If a guardian account hasn't been linked to this
  // application yet (e.g. a walk-in application, or a race with enrollment/account setup
  // still in progress), the insert below would fail on that constraint — catch it here with
  // a clear message instead of uploading to storage and then failing silently on insert.
  if (!application.guardian_id) {
    return { error: "This application isn't linked to a guardian account yet — please contact the school before uploading documents." };
  }

  const path = `${application.school_id}/${application.id}/${category}-${Date.now()}-${file.name}`;
  const { error: uploadError } = await admin.storage.from("application-documents").upload(path, file);
  if (uploadError) {
    console.error("uploadStatusDocument: storage upload failed", { applicationId: application.id, category, message: uploadError.message });
    return { error: uploadError.message };
  }

  // A resubmission replaces the pending review, not stacks alongside a rejected one — delete any
  // existing document in this category first so the reviewer sees exactly one, current copy.
  const { data: existing } = await admin
    .from("documents")
    .select("id, storage_path")
    .eq("application_id", application.id)
    .eq("category", category)
    .maybeSingle();
  if (existing) {
    await admin.storage.from("application-documents").remove([existing.storage_path]);
    await admin.from("documents").delete().eq("id", existing.id);
  }

  const { error: insertError } = await admin.from("documents").insert({
    school_id: application.school_id,
    application_id: application.id,
    category,
    file_name: file.name,
    storage_path: path,
    uploaded_by: application.guardian_id,
  });
  if (insertError) {
    // The file is already in storage at this point — if we don't record it, it becomes an
    // orphan with no linked row (this is exactly the bug this fix responds to). Log loudly so
    // it shows up in Vercel's server logs (the guardian only ever sees the returned error
    // message, never the server console), and remove the orphaned object rather than leaving
    // storage and the documents table out of sync.
    console.error("uploadStatusDocument: documents insert failed after storage upload succeeded", {
      applicationId: application.id,
      category,
      storagePath: path,
      message: insertError.message,
    });
    await admin.storage.from("application-documents").remove([path]);
    return { error: `Upload failed: ${insertError.message}` };
  }

  // A fresh/replacement upload while the application was waiting on it returns it to the
  // reviewer's queue (test checklist: "upload returns it to review").
  if (application.status === "documents_required") {
    await admin.from("applications").update({ status: "submitted" }).eq("id", application.id);
  }

  return { success: true };
}
