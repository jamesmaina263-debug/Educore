import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { ReportCardPicker } from "@/components/exams/report-card-picker";
import { ReportCardList, type ReportCardRow } from "@/components/exams/report-card-list";

export default async function ReportCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ exam?: string; class?: string }>;
}) {
  const { exam: examParam, class: classParam } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canGenerate }, { data: canApproveOwn }, { data: canApproveAny }] = await Promise.all([
    supabase
      .from("school_users")
      .select("full_name, roles(display_name), schools(name)")
      .eq("auth_user_id", user.id)
      .maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "exams.write" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "report_cards.approve" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "report_cards.approve_any" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  const { data: closedExams } = await supabase.from("exams").select("id, name").eq("status", "closed").order("created_at", { ascending: false });
  const examOptions = closedExams ?? [];
  const selectedExamId = examParam || examOptions[0]?.id || null;

  const { data: examClassRows } = selectedExamId
    ? await supabase.from("exam_classes").select("class_id, classes(id, name)").eq("exam_id", selectedExamId)
    : { data: [] };
  const classOptions = (examClassRows ?? []).map((r) => {
    const c = r.classes as unknown as { id: string; name: string };
    return { id: c.id, name: c.name };
  });
  const selectedClassId = classParam || classOptions[0]?.id || null;

  let rows: ReportCardRow[] = [];
  if (selectedExamId && selectedClassId) {
    const [{ data: streamRows }, { data: marksRows }, { data: reportCardRows }, { data: rankingRows }] = await Promise.all([
      supabase.from("streams").select("id").eq("class_id", selectedClassId),
      supabase
        .from("marks")
        .select("student_id, raw_score, subjects(name), grading_scale_bands(label)")
        .eq("exam_id", selectedExamId)
        .eq("class_id", selectedClassId),
      supabase.from("report_cards").select("student_id, comment, comment_source").eq("exam_id", selectedExamId).eq("class_id", selectedClassId),
      supabase.from("class_rankings").select("student_id, average_score, rank_in_stream").eq("exam_id", selectedExamId),
    ]);

    const streamIds = (streamRows ?? []).map((s) => s.id);
    const { data: students } = streamIds.length
      ? await supabase.from("students").select("id, first_name, last_name").in("current_class_id", streamIds).eq("status", "active").order("last_name")
      : { data: [] };

    const marksByStudent = new Map<string, ReportCardRow["marks"]>();
    for (const m of marksRows ?? []) {
      const list = marksByStudent.get(m.student_id) ?? [];
      list.push({
        subject_name: (m.subjects as unknown as { name: string } | null)?.name ?? "",
        raw_score: m.raw_score,
        band_label: (m.grading_scale_bands as unknown as { label: string } | null)?.label ?? null,
      });
      marksByStudent.set(m.student_id, list);
    }

    const reportCardByStudent = new Map((reportCardRows ?? []).map((rc) => [rc.student_id, rc]));
    const rankingByStudent = new Map((rankingRows ?? []).map((rk) => [rk.student_id, rk]));

    rows = (students ?? []).map((s) => {
      const rc = reportCardByStudent.get(s.id);
      const rk = rankingByStudent.get(s.id);
      return {
        student_id: s.id,
        full_name: `${s.first_name} ${s.last_name}`,
        marks: marksByStudent.get(s.id) ?? [],
        rank_in_stream: rk?.rank_in_stream ?? null,
        average_score: rk?.average_score ?? null,
        report_card: rc
          ? { comment: rc.comment, comment_source: rc.comment_source as "none" | "ai" | "teacher_approved" | "teacher_written" }
          : null,
      };
    });
  }

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Exams", href: "/exams" }, { label: "Report Cards" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Report Cards</h1>
            <p className="text-sm text-muted-foreground">Generated from closed exams only</p>
          </div>
          {examOptions.length > 0 && (
            <ReportCardPicker
              examOptions={examOptions}
              classOptions={classOptions}
              selectedExamId={selectedExamId}
              selectedClassId={selectedClassId}
            />
          )}
        </div>

        {examOptions.length === 0 ? (
          <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
            No closed exams yet — report cards can only be generated once an exam is closed.
          </div>
        ) : !selectedClassId ? (
          <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
            This exam has no classes configured.
          </div>
        ) : (
          <ReportCardList
            examId={selectedExamId as string}
            classId={selectedClassId}
            rows={rows}
            canGenerate={canGenerate === true}
            canApprove={canApproveOwn === true || canApproveAny === true}
          />
        )}
      </div>
    </AppShell>
  );
}
