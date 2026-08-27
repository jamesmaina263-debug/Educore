import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { ReviewScreen, type ApplicationDetail, type DocumentRequirementRow } from "@/components/admissions/review-screen";

export default async function AdmissionReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canReview }, { data: canWrite }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name, slug)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "admissions.read_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "admissions.write" }),
  ]);
  if (!canReview) redirect("/admissions");

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolInfo = schoolUser?.schools as unknown as { name: string; slug: string } | null;
  const schoolName = schoolInfo?.name;

  const { data: application } = await supabase
    .from("applications")
    .select(
      "id, school_id, application_number, status, application_source, admission_type, first_name, last_name, other_names, date_of_birth, gender, nationality, id_number, previous_school, previous_class, special_needs_info, notes, guardian_id, guardian_relationship, boarding_preference, transport_required, interview_date, interviewer_id, assessment_date, assessment_type, assessment_subject, assessment_score, assessment_comments, decision_by, decision_at, decision_notes, submitted_at, created_at, access_token, resulting_student_id, school_users!applications_guardian_id_fkey(full_name, phone, email)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!application) notFound();

  const { data: enrolledStudent } = application.resulting_student_id
    ? await supabase.from("students").select("admission_number").eq("id", application.resulting_student_id).maybeSingle()
    : { data: null };

  // Only needed for online applications' Accept dialog (term + class must be picked there so
  // the fee structure is real by the time the acceptance email goes out) — skip the query
  // otherwise.
  const [{ data: termRows }, { data: streamRows }] =
    application.application_source === "online"
      ? await Promise.all([
          supabase.from("terms").select("id, name, academic_year_id, academic_years(name)").eq("school_id", application.school_id).order("start_date"),
          supabase.from("streams").select("id, name, class_id, classes(name)").eq("school_id", application.school_id),
        ])
      : [{ data: [] }, { data: [] }];

  const termOptions = (termRows ?? []).map((t) => ({
    id: t.id,
    label: `${(t.academic_years as unknown as { name: string } | null)?.name ?? ""} — ${t.name}`,
  }));
  const streamOptions = (streamRows ?? []).map((s) => ({
    id: s.id,
    label: s.name ? `${(s.classes as unknown as { name: string } | null)?.name ?? ""} ${s.name}`.trim() : (s.classes as unknown as { name: string } | null)?.name ?? "",
  }));

  // Bug fix: complete_enrollment() intentionally reassigns verified documents from
  // application_id to student_id (and nulls application_id) once enrollment finishes — see
  // that function's migration. This page used to filter by application_id only, so any
  // already-completed admission's documents always showed as "Not uploaded" here even
  // though they genuinely were uploaded and verified; they'd just moved to the student
  // record. Checking both columns (via an OR) covers a document at either stage: still
  // pending on the application, or already reassigned to the enrolled student.
  const [{ data: requirementRows }, { data: documentRows }] = await Promise.all([
    supabase.from("application_document_requirements").select("category, label, required, display_order").eq("school_id", application.school_id).order("display_order"),
    application.resulting_student_id
      ? supabase
          .from("documents")
          .select("id, category, file_name, storage_path, storage_bucket, verification_status, verification_comment, created_at")
          .or(`application_id.eq.${id},student_id.eq.${application.resulting_student_id}`)
      : supabase
          .from("documents")
          .select("id, category, file_name, storage_path, storage_bucket, verification_status, verification_comment, created_at")
          .eq("application_id", id),
  ]);

  const documentsByCategory = new Map((documentRows ?? []).map((d) => [d.category, d]));

  const requirements: DocumentRequirementRow[] = (requirementRows ?? []).map((r) => {
    const doc = documentsByCategory.get(r.category);
    return {
      category: r.category,
      label: r.label,
      required: r.required,
      document: doc
        ? {
            id: doc.id,
            file_name: doc.file_name,
            storage_path: doc.storage_path,
            storage_bucket: doc.storage_bucket,
            verification_status: doc.verification_status as "pending" | "verified" | "rejected",
            verification_comment: doc.verification_comment,
          }
        : null,
    };
  });

  const guardian = application.school_users as unknown as { full_name: string; phone: string | null; email: string | null } | null;

  const detail: ApplicationDetail = {
    id: application.id,
    application_number: application.application_number,
    status: application.status,
    application_source: application.application_source,
    admission_type: application.admission_type,
    first_name: application.first_name,
    last_name: application.last_name,
    other_names: application.other_names,
    date_of_birth: application.date_of_birth,
    gender: application.gender,
    nationality: application.nationality,
    id_number: application.id_number,
    previous_school: application.previous_school,
    previous_class: application.previous_class,
    special_needs_info: application.special_needs_info,
    notes: application.notes,
    guardian_name: guardian?.full_name ?? "Unknown",
    guardian_phone: guardian?.phone ?? null,
    guardian_email: guardian?.email ?? null,
    guardian_relationship: application.guardian_relationship,
    boarding_preference: application.boarding_preference,
    transport_required: application.transport_required,
    interview_date: application.interview_date,
    assessment_date: application.assessment_date,
    assessment_type: application.assessment_type,
    assessment_subject: application.assessment_subject,
    assessment_score: application.assessment_score,
    assessment_comments: application.assessment_comments,
    decision_at: application.decision_at,
    decision_notes: application.decision_notes,
    submitted_at: application.submitted_at,
    created_at: application.created_at,
    enrolled_student_admission_number: enrolledStudent?.admission_number ?? null,
    access_token: application.access_token,
  };

  return (
    <AppShell
      breadcrumbs={[
        { label: schoolName ?? "EduCore", href: "/dashboard" },
        { label: "Admissions", href: "/admissions" },
        { label: `${detail.first_name} ${detail.last_name}` },
      ]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <ReviewScreen
        application={detail}
        requirements={requirements}
        canWrite={canWrite === true}
        schoolSlug={schoolInfo?.slug ?? ""}
        termOptions={termOptions}
        streamOptions={streamOptions}
      />
    </AppShell>
  );
}
