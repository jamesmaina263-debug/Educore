import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { ReportCardPicker } from "@/components/exams/report-card-picker";
import { ReportCardList, type ReportCardRow } from "@/components/exams/report-card-list";
import { TableExportMenu } from "@/components/shared/table-export-menu";
import { buildReportCardInsights } from "@/lib/academics/report-card-insights";

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
    const { data: examTermRow } = await supabase.from("exams").select("term_id").eq("id", selectedExamId).maybeSingle();

    const [{ data: streamRows }, { data: marksRows }, { data: reportCardRows }, { data: rankingRows }, { data: competencyRows }] =
      await Promise.all([
        supabase.from("streams").select("id").eq("class_id", selectedClassId),
        supabase
          .from("marks")
          .select("student_id, raw_score, subjects(name), grading_scale_bands(label, level_order, grading_scale_id)")
          .eq("exam_id", selectedExamId)
          .eq("class_id", selectedClassId),
        supabase.from("report_cards").select("student_id, comment, comment_source").eq("exam_id", selectedExamId).eq("class_id", selectedClassId),
        supabase.from("class_rankings").select("student_id, average_score, rank_in_stream").eq("exam_id", selectedExamId),
        supabase
          .from("competency_marks")
          .select(
            "student_id, grading_scale_bands(label, level_order, grading_scale_id), curriculum_sub_strands(name, curriculum_strands(name, subjects(name)))",
          )
          .eq("exam_id", selectedExamId)
          .eq("class_id", selectedClassId),
      ]);

    const streamIds = (streamRows ?? []).map((s) => s.id);
    const { data: students } = streamIds.length
      ? await supabase.from("students").select("id, first_name, last_name").in("current_class_id", streamIds).eq("status", "active").order("last_name")
      : { data: [] };

    // Core-competency/value/PCI ratings (Step 5/6) are term-scoped, not exam-scoped -- fetched
    // once for the whole roster + this exam's term, same shape as the portal page's own fetch.
    const studentIds = (students ?? []).map((s) => s.id);
    const { data: indicatorRows } = examTermRow?.term_id && studentIds.length
      ? await supabase
          .from("competency_indicator_ratings")
          .select("student_id, competency_indicators(name), grading_scale_bands(label, level_order, grading_scale_id)")
          .eq("term_id", examTermRow.term_id)
          .in("student_id", studentIds)
      : { data: [] };

    const scaleIds = new Set<string>();
    for (const m of marksRows ?? []) {
      const band = m.grading_scale_bands as unknown as { grading_scale_id: string } | null;
      if (band) scaleIds.add(band.grading_scale_id);
    }
    for (const c of competencyRows ?? []) {
      const band = c.grading_scale_bands as unknown as { grading_scale_id: string } | null;
      if (band) scaleIds.add(band.grading_scale_id);
    }
    for (const r of indicatorRows ?? []) {
      const band = r.grading_scale_bands as unknown as { grading_scale_id: string } | null;
      if (band) scaleIds.add(band.grading_scale_id);
    }
    const { data: allBandsForScales } = scaleIds.size
      ? await supabase.from("grading_scale_bands").select("grading_scale_id, level_order").in("grading_scale_id", [...scaleIds])
      : { data: [] };
    const maxLevelOrderByScale = new Map<string, number>();
    for (const b of allBandsForScales ?? []) {
      maxLevelOrderByScale.set(b.grading_scale_id, Math.max(maxLevelOrderByScale.get(b.grading_scale_id) ?? 0, b.level_order));
    }

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

    const competencyByStudent = new Map<string, ReportCardRow["competency"]>();
    for (const c of competencyRows ?? []) {
      const subStrand = c.curriculum_sub_strands as unknown as {
        name: string;
        curriculum_strands: { name: string; subjects: { name: string } | null } | null;
      } | null;
      const strand = subStrand?.curriculum_strands ?? null;
      const list = competencyByStudent.get(c.student_id) ?? [];
      list.push({
        subject_name: strand?.subjects?.name ?? "",
        strand_name: strand?.name ?? "",
        sub_strand_name: subStrand?.name ?? "",
        band_label: (c.grading_scale_bands as unknown as { label: string } | null)?.label ?? "—",
      });
      competencyByStudent.set(c.student_id, list);
    }

    // Achievement distribution + Strengths/Areas for Support (Phase 14 / Step 10) -- reuses
    // marks + competency_marks bands already fetched above, plus this exam's term-scoped
    // indicator ratings. Deliberately excludes growth-trend signals here (unlike the parent
    // portal's single-student view): computing getStudentGrowth() per row would mean 3 extra
    // queries multiplied by class size, a real N+1 for a large roster -- flagged as a known gap
    // rather than silently accepted, not solved in this pass.
    const insightsByStudent = new Map<string, ReturnType<typeof buildReportCardInsights>>();
    for (const s of students ?? []) {
      const rawMarkBands = (marksRows ?? []).filter((m) => m.student_id === s.id);
      const rawCompetencyBands = (competencyRows ?? []).filter((c) => c.student_id === s.id);
      const achievementBands = [
        ...rawMarkBands.flatMap((m) => {
          const band = m.grading_scale_bands as unknown as { label: string; level_order: number } | null;
          return band ? [{ label: band.label, levelOrder: band.level_order }] : [];
        }),
        ...rawCompetencyBands.flatMap((c) => {
          const band = c.grading_scale_bands as unknown as { label: string; level_order: number } | null;
          return band ? [{ label: band.label, levelOrder: band.level_order }] : [];
        }),
      ];
      const competencyRatings = [
        ...rawCompetencyBands.flatMap((c) => {
          const subStrand = c.curriculum_sub_strands as unknown as { name: string } | null;
          const band = c.grading_scale_bands as unknown as { label: string; level_order: number; grading_scale_id: string } | null;
          if (!subStrand || !band) return [];
          return [
            {
              name: subStrand.name,
              label: band.label,
              levelOrder: band.level_order,
              maxLevelOrder: maxLevelOrderByScale.get(band.grading_scale_id) ?? band.level_order,
            },
          ];
        }),
        ...(indicatorRows ?? [])
          .filter((r) => r.student_id === s.id)
          .flatMap((r) => {
            const indicator = r.competency_indicators as unknown as { name: string } | null;
            const band = r.grading_scale_bands as unknown as { label: string; level_order: number; grading_scale_id: string } | null;
            if (!indicator || !band) return [];
            return [
              {
                name: indicator.name,
                label: band.label,
                levelOrder: band.level_order,
                maxLevelOrder: maxLevelOrderByScale.get(band.grading_scale_id) ?? band.level_order,
              },
            ];
          }),
      ];
      insightsByStudent.set(
        s.id,
        buildReportCardInsights({ achievementBands, competencyRatings, improvingSubjects: [], decliningSubjects: [] }),
      );
    }

    rows = (students ?? []).map((s) => {
      const rc = reportCardByStudent.get(s.id);
      const rk = rankingByStudent.get(s.id);
      return {
        student_id: s.id,
        full_name: `${s.first_name} ${s.last_name}`,
        marks: marksByStudent.get(s.id) ?? [],
        competency: competencyByStudent.get(s.id) ?? [],
        rank_in_stream: rk?.rank_in_stream ?? null,
        average_score: rk?.average_score ?? null,
        insights: insightsByStudent.get(s.id) ?? { achievementDistribution: [], strengths: [], areasForSupport: [] },
        report_card: rc
          ? { comment: rc.comment, comment_source: rc.comment_source as "none" | "ai" | "teacher_approved" | "teacher_written" }
          : null,
      };
    });
  }

  // Union of subjects across the class, alphabetical, so every student's row has the same
  // columns in the same order regardless of which subjects they individually have marks for.
  const subjectNames = Array.from(new Set(rows.flatMap((r) => r.marks.map((m) => m.subject_name)))).sort();
  const markSheetRows = rows.map((r) => {
    const scoreBySubject = new Map(r.marks.map((m) => [m.subject_name, m.raw_score]));
    const row: Record<string, string | number> = { Student: r.full_name };
    for (const subject of subjectNames) {
      row[subject] = scoreBySubject.get(subject) ?? "";
    }
    row["Average"] = r.average_score ?? "";
    row["Rank"] = r.rank_in_stream ?? "";
    return row;
  });
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
            {rows.length > 0 && (
              <TableExportMenu
                filenameStub={`${schoolName ?? "educore"}-${selectedClassName}-mark-sheet`}
                title="Class Mark Sheet"
                subtitle={[schoolName, selectedExamName, selectedClassName].filter(Boolean).join(" · ")}
                rows={markSheetRows}
              />
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
