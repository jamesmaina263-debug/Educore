import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { CurriculumUploadSection, type SubjectOption, type BatchWithDrafts } from "@/components/academics/curriculum-upload-section";

export default async function CurriculumContentPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string }>;
}) {
  const { subject: subjectParam } = await searchParams;

  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canWrite }, { data: canUpload }, { data: canRead }, { data: subjects }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.write" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.curriculum_upload" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.read" }),
    supabase.from("subjects").select("id, name").order("name"),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  const canUploadDocuments = canWrite === true || canUpload === true;
  const canReview = canWrite === true;
  const canViewContent = canRead === true;

  const subjectOptions: SubjectOption[] = subjects ?? [];
  const selectedSubjectId = subjectParam || subjectOptions[0]?.id || null;

  let batches: BatchWithDrafts[] = [];

  if (selectedSubjectId && (canViewContent || canUploadDocuments)) {
    const { data: batchRows } = await supabase
      .from("curriculum_extraction_batches")
      .select("id, file_name, status, failure_category, strands_extracted, sub_strands_extracted, created_at")
      .eq("subject_id", selectedSubjectId)
      .order("created_at", { ascending: false });

    const batchIds = (batchRows ?? []).map((b) => b.id);

    const { data: strandRows } = batchIds.length
      ? await supabase
          .from("curriculum_strands")
          .select(
            "id, name, extraction_batch_id, curriculum_sub_strands(id, name, learning_outcomes, key_inquiry_questions, rubric_text, content_source, extraction_batch_id)",
          )
          .eq("subject_id", selectedSubjectId)
          .in("extraction_batch_id", batchIds)
      : { data: [] };

    type SubRow = {
      id: string;
      name: string;
      learning_outcomes: string | null;
      key_inquiry_questions: string | null;
      rubric_text: string | null;
      content_source: "school_authored" | "kicd_licensed" | "draft";
      extraction_batch_id: string | null;
    };

    batches = (batchRows ?? []).map((b) => {
      const strandsForBatch = (strandRows ?? []).filter((s) => s.extraction_batch_id === b.id);
      return {
        id: b.id,
        fileName: b.file_name,
        status: b.status as "processing" | "extracted" | "failed",
        failureCategory: b.failure_category,
        strandsExtracted: b.strands_extracted,
        subStrandsExtracted: b.sub_strands_extracted,
        createdAt: b.created_at,
        strands: strandsForBatch.map((s) => ({
          id: s.id,
          name: s.name,
          subStrands: ((s.curriculum_sub_strands as unknown as SubRow[]) ?? [])
            .filter((ss) => ss.extraction_batch_id === b.id)
            .map((ss) => ({
              id: ss.id,
              name: ss.name,
              learningOutcomes: ss.learning_outcomes,
              keyInquiryQuestions: ss.key_inquiry_questions,
              rubricText: ss.rubric_text,
              contentSource: ss.content_source,
            })),
        })),
      };
    });
  }

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Academics", href: "/academics/subjects" }, { label: "Curriculum Content" }]}
      userName={schoolUser?.full_name}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Curriculum Content</h1>
          <p className="text-sm text-muted-foreground">
            Upload your school&apos;s own curriculum document for a subject so AI-drafted Schemes of Work can be grounded in it, rather
            than generic guessing.
          </p>
        </div>

        {!canViewContent && !canUploadDocuments ? (
          <p className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
            You don&apos;t have permission to view or upload curriculum content.
          </p>
        ) : (
          <CurriculumUploadSection
            subjectOptions={subjectOptions}
            selectedSubjectId={selectedSubjectId}
            batches={batches}
            canUpload={canUploadDocuments}
            canReview={canReview}
          />
        )}
      </div>
    </AppShell>
  );
}
