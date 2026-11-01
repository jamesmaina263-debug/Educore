import { selectInChunks } from "@/lib/academics/in-chunks";
import type { createClient } from "@/lib/supabase/server";
import { loadReportSettings } from "@/lib/academics/report-settings";
import { assessmentKindOf, assessmentTitle, gradingLabel, MISSING } from "@/lib/academics/mark-sheet-model";

// Loader + pure rules for the printable report card (staff print route and the parent portal
// route share it, like getPaymentReceipt does for receipts). Access is enforced entirely by the
// existing RLS: staff see report cards per exams.read, a guardian/student sees a card, its
// marks and its rank ONLY once the comment is teacher_approved/teacher_written (see
// portals_rls_readiness). This module adds no permission logic of its own; a card the caller
// can't see simply isn't returned.

export type CommentSource = "none" | "ai" | "teacher_approved" | "teacher_written";

/** A report card is "released" once a teacher has approved or written the comment. */
export function isReleased(source: string | null | undefined): boolean {
  return source === "teacher_approved" || source === "teacher_written";
}

/**
 * Comment text that may be printed. An AI draft (or no comment) is never printed as if final,
 * so a staff member printing before approval cannot hand a parent unreviewed AI text.
 */
export function releasedComment(source: string | null | undefined, comment: string | null | undefined): string | null {
  if (!isReleased(source)) return null;
  const text = comment?.trim();
  return text ? text : null;
}

/** The assessment details block, worded exactly like the class mark sheet header. */
export interface ReportCardDetails {
  assessment: string;
  termYear: string;
  grading: string;
  /** ISO timestamp of when this document was produced. */
  generatedAt: string;
  /**
   * Active learners in the class (all streams). null when not loaded: the parent portal doesn't ask,
   * because RLS only lets a guardian see their own children, so a count there would be wrong.
   */
  classSize: number | null;
}

export interface ReportCardDocumentData {
  school: { name: string; logoUrl: string | null; primaryColor: string | null; address: string | null; phone: string | null };
  exam: { id: string; name: string; termName: string | null };
  details: ReportCardDetails;
  student: { id: string; fullName: string; admissionNumber: string | null; classLabel: string };
  /** Score for numeric exams, grade/band for CBC exams; either may be null. */
  subjects: { subject: string; score: number | null; grade: string | null }[];
  competencies: { subject: string; strand: string; subStrand: string; rating: string }[];
  average: number | null;
  rank: number | null;
  released: boolean;
  /** Only ever the released comment (see releasedComment). */
  comment: string | null;
  /** Term attendance from the register; null when the section is off or the register has no records for this learner in the term. */
  attendance: AttendanceSummary | null;
  /** The head teacher's comment; null when none was written or the section is off. */
  headTeacherComment: string | null;
  /** The school's report options (report-settings.ts). */
  options: { showRank: boolean; showCompetencies: boolean; showSignatures: boolean; showAcknowledgement: boolean };
}

export interface AttendanceSummary {
  presentDays: number;
  lateDays: number;
  absentDays: number;
  /** Days with a register entry in the term. A learner with none has no summary at all. */
  recordedDays: number;
  /** (present + late) / recorded, one decimal place. */
  attendancePercent: number;
}

/** One summary row -> the printed figures. No recorded days = no summary (never a made-up 0%). */
export function summariseAttendance(row: { present_days: number; late_days: number; absent_days: number; recorded_days: number } | null | undefined): AttendanceSummary | null {
  if (!row || !(row.recorded_days > 0)) return null;
  const attended = row.present_days + row.late_days;
  return {
    presentDays: row.present_days,
    lateDays: row.late_days,
    absentDays: row.absent_days,
    recordedDays: row.recorded_days,
    attendancePercent: Math.round((attended / row.recorded_days) * 1000) / 10,
  };
}

type Client = Awaited<ReturnType<typeof createClient>>;

// streamId = one stream's active students (the "print this stream" button on the Report Cards page).
export type ReportCardScope = { classId: string } | { streamId: string } | { studentId: string } | { all: true };

export async function loadReportCardDocuments(
  supabase: Client,
  examId: string,
  scope: ReportCardScope,
  opts: { includeClassSize?: boolean } = {},
): Promise<ReportCardDocumentData[]> {
  const cardColumns = "id, student_id, class_id, comment, comment_source";
  type CardRow = { id: string; student_id: string; class_id: string | null; comment: string | null; comment_source: string };
  let cards: CardRow[];
  if ("streamId" in scope) {
    // Same population the Report Cards page lists for a stream: active students currently in it.
    const { data: roster } = await supabase.from("students").select("id").eq("current_class_id", scope.streamId).eq("status", "active");
    const rosterIds = (roster ?? []).map((r) => r.id as string);
    if (rosterIds.length === 0) return [];
    cards = await selectInChunks<CardRow>(rosterIds, 100, (ids) =>
      supabase.from("report_cards").select(cardColumns).eq("exam_id", examId).in("student_id", ids),
    );
  } else {
    let cardQuery = supabase.from("report_cards").select(cardColumns).eq("exam_id", examId);
    if ("classId" in scope) cardQuery = cardQuery.eq("class_id", scope.classId);
    if ("studentId" in scope) cardQuery = cardQuery.eq("student_id", scope.studentId);
    const { data } = await cardQuery;
    cards = (data ?? []) as unknown as CardRow[];
  }
  if (cards.length === 0) return [];
  const studentIds = cards.map((c) => c.student_id as string);

  // Per-student queries are chunked (see in-chunks.ts): a whole class would otherwise blow the URL
  // length and the ~1000-row API cap, silently dropping marks from printed cards.
  const [{ data: exam }, students, marks, rankings, competency] = await Promise.all([
    supabase.from("exams").select("id, name, exam_type, terms(name, academic_years(name))").eq("id", examId).maybeSingle(),
    selectInChunks<Record<string, unknown>>(studentIds, 100, (ids) =>
      supabase
        .from("students")
        .select("id, school_id, first_name, last_name, other_names, admission_number, streams(name, classes(name))")
        .in("id", ids),
    ),
    selectInChunks<Record<string, unknown>>(studentIds, 40, (ids) =>
      supabase.from("marks").select("student_id, raw_score, subjects(name), grading_scale_bands(label)").eq("exam_id", examId).in("student_id", ids),
    ),
    selectInChunks<{ student_id: string; average_score: number | null; rank_in_stream: number | null }>(studentIds, 200, (ids) =>
      supabase.from("class_rankings").select("student_id, average_score, rank_in_stream").eq("exam_id", examId).in("student_id", ids),
    ),
    // A CBC learner can have dozens of sub-strand ratings, so this one chunks small.
    selectInChunks<Record<string, unknown>>(studentIds, 8, (ids) =>
      supabase
        .from("competency_marks")
        .select("student_id, grading_scale_bands(label), curriculum_sub_strands(name, curriculum_strands(name, subjects(name)))")
        .eq("exam_id", examId)
        .in("student_id", ids),
    ),
  ]);
  if (!exam || !students || students.length === 0) return [];

  const schoolId = (students[0] as { school_id: string }).school_id;
  const [{ data: school }, settings] = await Promise.all([
    supabase.from("schools").select("name, logo_url, primary_color, address, phone").eq("id", schoolId).maybeSingle(),
    loadReportSettings(supabase, schoolId),
  ]);

  // Class size is a class-wide statistic, so it is only read where the caller can see the whole
  // roster (staff print route). Same rule as the mark sheet: active learners across all streams.
  const classSizeByClass = new Map<string, number>();
  if (opts.includeClassSize) {
    const classIds = [...new Set(cards.map((c) => c.class_id as string | null).filter((v): v is string => !!v))];
    if (classIds.length > 0) {
      const { data: streamRows } = await supabase.from("streams").select("id, class_id").in("class_id", classIds);
      const classOfStream = new Map((streamRows ?? []).map((st) => [st.id as string, st.class_id as string]));
      if (classOfStream.size > 0) {
        const { data: roster } = await supabase
          .from("students")
          .select("id, current_class_id")
          .in("current_class_id", [...classOfStream.keys()])
          .eq("status", "active");
        for (const r of roster ?? []) {
          const classId = classOfStream.get(r.current_class_id as string);
          if (classId) classSizeByClass.set(classId, (classSizeByClass.get(classId) ?? 0) + 1);
        }
      }
    }
  }
  // Optional sections: only queried when the school switched them on. Both run under the caller's
  // own RLS, so a section the caller may not read comes back empty and is simply left out.
  const [attendanceRes, headCommentRows] = await Promise.all([
    settings.showAttendance ? supabase.rpc("report_card_attendance_summary", { p_exam_id: examId, p_student_ids: studentIds }) : Promise.resolve({ data: null }),
    settings.showHeadTeacherComment
      ? selectInChunks<{ report_card_id: string; comment: string }>(
          cards.map((c) => c.id as string),
          100,
          (ids) => supabase.from("report_card_head_comments").select("report_card_id, comment").in("report_card_id", ids),
        )
      : Promise.resolve([] as { report_card_id: string; comment: string }[]),
  ]);
  const attendanceByStudent = new Map(
    ((attendanceRes.data ?? []) as { student_id: string; present_days: number; late_days: number; absent_days: number; recorded_days: number }[]).map((r) => [r.student_id, r]),
  );
  const headCommentByCard = new Map(headCommentRows.map((r) => [r.report_card_id, r.comment]));
  const generatedAt = new Date().toISOString();

  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const cardByStudent = new Map(cards.map((c) => [c.student_id as string, c]));
  const rankByStudent = new Map((rankings ?? []).map((r) => [r.student_id as string, r]));
  const term = one(exam.terms as unknown as { name: string; academic_years: { name: string } | { name: string }[] | null } | { name: string; academic_years: { name: string } | { name: string }[] | null }[] | null);
  const termName = term?.name ?? null;
  const termYear = [termName, one(term?.academic_years)?.name].filter(Boolean).join(", ") || MISSING;
  const assessment = assessmentTitle(exam.name as string, (exam as { exam_type?: string }).exam_type ?? "");

  const docs = (students as unknown as Record<string, unknown>[]).map((s): ReportCardDocumentData => {
    const id = s.id as string;
    const card = cardByStudent.get(id);
    const rank = rankByStudent.get(id);
    const stream = one(s.streams as { name: string; classes: { name: string } | { name: string }[] | null } | { name: string; classes: { name: string } | null }[] | null);
    const className = one(stream?.classes as { name: string } | { name: string }[] | null | undefined)?.name ?? "";
    const subjects = (marks ?? [])
      .filter((m) => m.student_id === id)
      .map((m) => ({
        subject: one(m.subjects as unknown as { name: string } | { name: string }[] | null)?.name ?? "",
        score: m.raw_score === null || m.raw_score === undefined ? null : Number(m.raw_score),
        grade: one(m.grading_scale_bands as unknown as { label: string } | { label: string }[] | null)?.label ?? null,
      }))
      .sort((a, b) => a.subject.localeCompare(b.subject));
    const competencies = (competency ?? [])
      .filter((c) => c.student_id === id)
      .map((c) => {
        const sub = one(c.curriculum_sub_strands as unknown as { name: string; curriculum_strands: unknown } | null);
        const strand = one((sub?.curriculum_strands ?? null) as { name: string; subjects: { name: string } | { name: string }[] | null } | null);
        return {
          subject: one(strand?.subjects)?.name ?? "",
          strand: strand?.name ?? "",
          subStrand: sub?.name ?? "",
          rating: one(c.grading_scale_bands as unknown as { label: string } | { label: string }[] | null)?.label ?? "—",
        };
      });
    return {
      school: {
        name: school?.name ?? "EduCore School",
        logoUrl: school?.logo_url ?? null,
        primaryColor: school?.primary_color ?? null,
        address: school?.address ?? null,
        phone: school?.phone ?? null,
      },
      exam: { id: examId, name: exam.name as string, termName },
      details: {
        assessment,
        termYear,
        grading: gradingLabel(assessmentKindOf(subjects.map((m) => ({ rawScore: m.score, bandLabel: m.grade })))),
        generatedAt,
        classSize: card?.class_id ? (classSizeByClass.get(card.class_id as string) ?? null) : null,
      },
      student: {
        id,
        fullName: [s.first_name, s.other_names, s.last_name].filter(Boolean).join(" "),
        admissionNumber: (s.admission_number as string | null) ?? null,
        classLabel: stream ? `${className} ${stream.name}`.trim() : "—",
      },
      subjects,
      competencies,
      average: rank?.average_score === null || rank?.average_score === undefined ? null : Number(rank.average_score),
      rank: rank?.rank_in_stream ?? null,
      released: isReleased(card?.comment_source),
      comment: releasedComment(card?.comment_source, card?.comment),
      attendance: settings.showAttendance ? summariseAttendance(attendanceByStudent.get(id)) : null,
      headTeacherComment: settings.showHeadTeacherComment && card ? (headCommentByCard.get(card.id as string) ?? null) : null,
      options: {
        showRank: settings.rankingEnabled,
        showCompetencies: settings.showCompetencyRatings,
        showSignatures: settings.showSignatures,
        showAcknowledgement: settings.showParentAcknowledgement,
      },
    };
  });

  // Alphabetical by surname (the order the staff Report Cards page uses).
  const lastNameById = new Map((students as unknown as { id: string; last_name: string }[]).map((s) => [s.id, s.last_name]));
  return docs.sort((a, b) => (lastNameById.get(a.student.id) ?? "").localeCompare(lastNameById.get(b.student.id) ?? ""));
}
