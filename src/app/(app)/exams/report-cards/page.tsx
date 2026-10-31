import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { ReportCardPicker } from "@/components/exams/report-card-picker";
import { ClassOverviewGrid } from "@/components/exams/class-overview-grid";
import { GenerateAllClasses } from "@/components/exams/generate-all-classes";
import { ClassReportCardsView } from "@/components/exams/class-report-cards-view";
import { ClassExportsMenu } from "@/components/exams/class-exports-menu";
import { loadClassOverview, sortExamClasses } from "@/lib/academics/load-class-overview";
import { cardStatusOf, streamsUserCanApprove, summariseClassStatus, type StreamGroup, type StudentSummary } from "@/lib/academics/report-card-status";
import { DEFAULT_REPORT_SETTINGS, loadReportSettings } from "@/lib/academics/report-settings";

export default async function ReportCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ exam?: string; class?: string }>;
}) {
  const { exam: examParam, class: classParam } = await searchParams;

  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canGenerate }, { data: canApproveOwn }, { data: canApproveAny }, { data: canCommentHead }] = await Promise.all([
    supabase
      .from("school_users")
      .select("id, school_id, full_name, roles(display_name), schools(name)")
      .eq("auth_user_id", user.id)
      .maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "exams.write" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "report_cards.approve" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "report_cards.approve_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "report_cards.comment_head" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  const { data: closedExams } = await supabase.from("exams").select("id, name").eq("status", "closed").order("created_at", { ascending: false });
  const examOptions = closedExams ?? [];
  const selectedExamId = examParam || examOptions[0]?.id || null;

  const { data: examClassRows } = selectedExamId
    ? await supabase.from("exam_classes").select("class_id, classes(id, name, level_order)").eq("exam_id", selectedExamId)
    : { data: [] };
  const classOptions = sortExamClasses(
    (examClassRows ?? []).map((r) => {
      const c = r.classes as unknown as { id: string; name: string; level_order: number | null };
      return { id: c.id, name: c.name, levelOrder: c.level_order ?? 0 };
    }),
  );
  // No class chosen (or an unknown one) -> the class overview. A class is only opened on purpose.
  const selectedClassId = classParam && classOptions.some((c) => c.id === classParam) ? classParam : null;

  const overviewRows = selectedExamId && !selectedClassId ? await loadClassOverview(supabase, selectedExamId, classOptions) : [];

  // Class view: compact per-student summaries only (name, admission number, average, rank, comment
  // status). Marks, competency ratings and insights are loaded per student when a row is expanded.
  let streamGroups: StreamGroup[] = [];
  let classSummary = summariseClassStatus(0, []);
  if (selectedExamId && selectedClassId) {
    const { data: streamRows } = await supabase.from("streams").select("id, name, class_teacher_id").eq("class_id", selectedClassId);
    const streamIds = (streamRows ?? []).map((st) => st.id as string);

    const [{ data: students }, { data: reportCardRows }, { data: rankingRows }] = streamIds.length
      ? await Promise.all([
          supabase
            .from("students")
            .select("id, first_name, last_name, admission_number, current_class_id")
            .in("current_class_id", streamIds)
            .eq("status", "active")
            .order("last_name")
            .order("first_name"),
          supabase.from("report_cards").select("id, student_id, comment_source, comment").eq("exam_id", selectedExamId).eq("class_id", selectedClassId),
          // Scoped to this class (class_rankings carries class_id), not the whole exam.
          supabase
            .from("class_rankings")
            .select("student_id, average_score, rank_in_stream")
            .eq("exam_id", selectedExamId)
            .eq("class_id", selectedClassId),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];

    const reportCardByStudent = new Map((reportCardRows ?? []).map((rc) => [rc.student_id as string, rc]));
    const rankingByStudent = new Map((rankingRows ?? []).map((rk) => [rk.student_id as string, rk]));

    const byStream = new Map<string, StudentSummary[]>();
    for (const st of students ?? []) {
      const rc = reportCardByStudent.get(st.id as string);
      const rk = rankingByStudent.get(st.id as string);
      const list = byStream.get(st.current_class_id as string) ?? [];
      list.push({
        student_id: st.id as string,
        full_name: `${st.first_name} ${st.last_name}`,
        admission_number: (st.admission_number as string | null) ?? null,
        stream_id: st.current_class_id as string,
        average_score: (rk?.average_score as number | null | undefined) ?? null,
        rank_in_stream: (rk?.rank_in_stream as number | null | undefined) ?? null,
        status: cardStatusOf(rc ? { comment_source: rc.comment_source as string, comment: rc.comment as string | null } : null),
        report_card_id: (rc?.id as string | undefined) ?? null,
      });
      byStream.set(st.current_class_id as string, list);
    }
    const approvable = streamsUserCanApprove({
      canApproveAny: canApproveAny === true,
      canApproveOwn: canApproveOwn === true,
      schoolUserId: (schoolUser?.id as string | undefined) ?? null,
      streams: (streamRows ?? []).map((st) => ({ id: st.id as string, class_teacher_id: (st.class_teacher_id as string | null) ?? null })),
    });
    streamGroups = (streamRows ?? [])
      .map((st) => ({
        id: st.id as string,
        name: st.name as string,
        canApprove: approvable.has(st.id as string),
        students: byStream.get(st.id as string) ?? [],
      }))
      .filter((g) => g.students.length > 0)
      .sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));

    // Same population as the overview card: active students in this class's streams, and the cards
    // belonging to them.
    const activeIds = new Set((students ?? []).map((st) => st.id as string));
    classSummary = summariseClassStatus(
      activeIds.size,
      (reportCardRows ?? []).filter((rc) => activeIds.has(rc.student_id as string)).map((rc) => ({ comment_source: rc.comment_source as string })),
    );
  }

  const reportSettings = schoolUser?.school_id ? await loadReportSettings(supabase, schoolUser.school_id as string) : DEFAULT_REPORT_SETTINGS;
  const selectedClassName = classOptions.find((c) => c.id === selectedClassId)?.name ?? "";
  const selectedExamName = examOptions.find((e) => e.id === selectedExamId)?.name ?? "";

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
          <div className="flex items-center gap-2">
            {classSummary.total > 0 && selectedExamId && selectedClassId && (
              <ClassExportsMenu examId={selectedExamId} classId={selectedClassId} filenameBase={`${schoolName ?? "educore"}-${selectedClassName}-${selectedExamName}`} />
            )}
            {classSummary.generated > 0 && selectedExamId && selectedClassId && (
              <Link
                href={`/exams/report-cards/print?exam=${selectedExamId}&class=${selectedClassId}`}
                target="_blank"
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
              >
                Print all
              </Link>
            )}
            {examOptions.length > 0 && (
              <ReportCardPicker
                examOptions={examOptions}
                classOptions={classOptions}
                selectedExamId={selectedExamId}
                selectedClassId={selectedClassId}
              />
            )}
          </div>
        </div>

        {examOptions.length === 0 ? (
          <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
            No closed exams yet — report cards can only be generated once an exam is closed.
          </div>
        ) : classOptions.length === 0 ? (
          <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
            This exam has no classes configured.
          </div>
        ) : !selectedClassId ? (
          <>
            <GenerateAllClasses examId={selectedExamId as string} rows={overviewRows} canGenerate={canGenerate === true} />
            <ClassOverviewGrid examId={selectedExamId as string} rows={overviewRows} />
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm">
              <Link
                href={`/exams/report-cards?exam=${encodeURIComponent(selectedExamId as string)}`}
                className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                ← All classes
              </Link>
              <span className="text-muted-foreground">/</span>
              <span className="font-medium">{selectedClassName}</span>
            </div>
            <ClassReportCardsView
              examId={selectedExamId as string}
              classId={selectedClassId}
              streams={streamGroups}
              summary={classSummary}
              canGenerate={canGenerate === true}
              rankingEnabled={reportSettings.rankingEnabled}
              headCommentEnabled={reportSettings.showHeadTeacherComment}
              canCommentHead={canCommentHead === true}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
