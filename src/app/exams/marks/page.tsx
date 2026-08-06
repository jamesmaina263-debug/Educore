import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { MarksPicker } from "@/components/exams/marks-picker";
import { MarksEntryForm, type MarksRosterRow, type BandOption } from "@/components/exams/marks-entry-form";
import {
  CompetencyMarksSection,
  type StrandOption,
  type CompetencyRatingRow,
} from "@/components/exams/competency-marks-section";

export default async function MarksPage({
  searchParams,
}: {
  searchParams: Promise<{ exam?: string; class?: string; subject?: string }>;
}) {
  const { exam: examId, class: classParam, subject: subjectParam } = await searchParams;
  if (!examId) redirect("/exams");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canWriteAny }, { data: canWrite }, { data: canManageCurriculum }] = await Promise.all([
    supabase
      .from("school_users")
      .select("full_name, roles(display_name), schools(name)")
      .eq("auth_user_id", user.id)
      .maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "marks.write_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "marks.write" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.write" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  const { data: exam } = await supabase.from("exams").select("id, name, status").eq("id", examId).maybeSingle();
  if (!exam) redirect("/exams");

  const { data: examClassRows } = await supabase
    .from("exam_classes")
    .select("class_id, classes(id, name, grading_scale_id)")
    .eq("exam_id", examId);

  const classOptions = (examClassRows ?? []).map((r) => {
    const c = r.classes as unknown as { id: string; name: string; grading_scale_id: string | null };
    return { id: c.id, name: c.name, grading_scale_id: c.grading_scale_id };
  });

  const selectedClassId = classParam || classOptions[0]?.id || null;
  const selectedClass = classOptions.find((c) => c.id === selectedClassId) ?? null;

  const { data: examSubjectRows } = selectedClassId
    ? await supabase
        .from("exam_subjects")
        .select("subject_id, max_score, subjects(id, name)")
        .eq("exam_id", examId)
        .eq("class_id", selectedClassId)
    : { data: [] };

  const subjectOptions = (examSubjectRows ?? []).map((r) => {
    const s = r.subjects as unknown as { id: string; name: string };
    return { id: s.id, name: s.name, max_score: r.max_score as number };
  });

  const selectedSubjectId = subjectParam || subjectOptions[0]?.id || null;
  const selectedSubject = subjectOptions.find((s) => s.id === selectedSubjectId) ?? null;

  let gradingModel: "numeric" | "cbc" = "numeric";
  let bandOptions: BandOption[] = [];
  let roster: MarksRosterRow[] = [];
  let strandsWithSubStrands: StrandOption[] = [];
  let competencyRatings: CompetencyRatingRow[] = [];

  if (selectedClass && selectedSubjectId) {
    // Resolve the class's effective grading scale: its own override, else the school default.
    const { data: scale } = selectedClass.grading_scale_id
      ? await supabase.from("grading_scales").select("id, model_type").eq("id", selectedClass.grading_scale_id).maybeSingle()
      : await supabase.from("grading_scales").select("id, model_type").eq("is_default", true).maybeSingle();

    if (scale) {
      gradingModel = scale.model_type as "numeric" | "cbc";
      const { data: bands } = await supabase
        .from("grading_scale_bands")
        .select("id, label, level_order")
        .eq("grading_scale_id", scale.id)
        .order("level_order");
      bandOptions = (bands ?? []).map((b) => ({ id: b.id, label: b.label }));
    }

    const [{ data: streamRows }, { data: existingMarks }] = await Promise.all([
      supabase.from("streams").select("id").eq("class_id", selectedClass.id),
      supabase.from("marks").select("student_id, raw_score, band_id").eq("exam_id", examId).eq("subject_id", selectedSubjectId),
    ]);
    const streamIds = (streamRows ?? []).map((s) => s.id);

    const { data: students } = streamIds.length
      ? await supabase
          .from("students")
          .select("id, first_name, last_name")
          .in("current_class_id", streamIds)
          .eq("status", "active")
          .order("last_name")
      : { data: [] };

    const existingByStudent = new Map((existingMarks ?? []).map((m) => [m.student_id, { raw_score: m.raw_score, band_id: m.band_id }]));

    roster = (students ?? []).map((s) => ({
      student_id: s.id,
      full_name: `${s.first_name} ${s.last_name}`,
      existing: existingByStudent.get(s.id) ?? null,
    }));

    if (gradingModel === "cbc") {
      const { data: strandRows } = await supabase
        .from("curriculum_strands")
        .select("id, name, level_order, curriculum_sub_strands(id, name, level_order)")
        .eq("subject_id", selectedSubjectId)
        .order("level_order");

      strandsWithSubStrands = (strandRows ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        sub_strands: ((s.curriculum_sub_strands as unknown as { id: string; name: string; level_order: number }[]) ?? [])
          .sort((a, b) => a.level_order - b.level_order)
          .map((ss) => ({ id: ss.id, name: ss.name })),
      }));

      const subStrandIds = strandsWithSubStrands.flatMap((s) => s.sub_strands.map((ss) => ss.id));
      const { data: existingCompetency } = subStrandIds.length
        ? await supabase
            .from("competency_marks")
            .select("student_id, sub_strand_id, band_id")
            .eq("exam_id", examId)
            .in("sub_strand_id", subStrandIds)
        : { data: [] };
      competencyRatings = existingCompetency ?? [];
    }
  }

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Exams", href: "/exams" }, { label: "Marks" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">{exam.name}</h1>
            <p className="text-sm text-muted-foreground">{exam.status === "open" ? "Open" : "Closed"} — marks entry</p>
          </div>
          {selectedClassId && (
            <MarksPicker
              examId={examId}
              classOptions={classOptions}
              subjectOptions={subjectOptions}
              selectedClassId={selectedClassId}
              selectedSubjectId={selectedSubjectId}
            />
          )}
        </div>

        {!selectedClassId || !selectedSubjectId ? (
          <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            This exam has no classes or subjects configured yet.
          </p>
        ) : (
          <MarksEntryForm
            examId={examId}
            classId={selectedClassId}
            subjectId={selectedSubjectId}
            gradingModel={gradingModel}
            bandOptions={bandOptions}
            maxScore={selectedSubject?.max_score ?? 100}
            roster={roster}
            examStatus={exam.status as "open" | "closed"}
            canEnter={canWriteAny === true || canWrite === true}
          />
        )}

        {selectedClassId && selectedSubjectId && gradingModel === "cbc" && (
          <CompetencyMarksSection
            examId={examId}
            classId={selectedClassId}
            subjectId={selectedSubjectId}
            strands={strandsWithSubStrands}
            bandOptions={bandOptions}
            roster={roster.map((r) => ({ student_id: r.student_id, full_name: r.full_name }))}
            existingRatings={competencyRatings}
            examStatus={exam.status as "open" | "closed"}
            canEnter={canWriteAny === true || canWrite === true}
            canManageCurriculum={canManageCurriculum === true}
          />
        )}
      </div>
    </AppShell>
  );
}
