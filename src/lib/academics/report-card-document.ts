import type { createClient } from "@/lib/supabase/server";
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
}

type Client = Awaited<ReturnType<typeof createClient>>;

export type ReportCardScope = { classId: string } | { studentId: string } | { all: true };

export async function loadReportCardDocuments(
  supabase: Client,
  examId: string,
  scope: ReportCardScope,
  opts: { includeClassSize?: boolean } = {},
): Promise<ReportCardDocumentData[]> {
  let cardQuery = supabase.from("report_cards").select("student_id, class_id, comment, comment_source").eq("exam_id", examId);
  if ("classId" in scope) cardQuery = cardQuery.eq("class_id", scope.classId);
  if ("studentId" in scope) cardQuery = cardQuery.eq("student_id", scope.studentId);
  const { data: cards } = await cardQuery;
  if (!cards || cards.length === 0) return [];
  const studentIds = cards.map((c) => c.student_id as string);

  const [{ data: exam }, { data: students }, { data: marks }, { data: rankings }, { data: competency }] = await Promise.all([
    supabase.from("exams").select("id, name, exam_type, terms(name, academic_years(name))").eq("id", examId).maybeSingle(),
    supabase
      .from("students")
      .select("id, school_id, first_name, last_name, other_names, admission_number, streams(name, classes(name))")
      .in("id", studentIds),
    supabase.from("marks").select("student_id, raw_score, subjects(name), grading_scale_bands(label)").eq("exam_id", examId).in("student_id", studentIds),
    supabase.from("class_rankings").select("student_id, average_score, rank_in_stream").eq("exam_id", examId).in("student_id", studentIds),
    supabase
      .from("competency_marks")
      .select("student_id, grading_scale_bands(label), curriculum_sub_strands(name, curriculum_strands(name, subjects(name)))")
      .eq("exam_id", examId)
      .in("student_id", studentIds),
  ]);
  if (!exam || !students || students.length === 0) return [];

  const schoolId = (students[0] as { school_id: string }).school_id;
  const { data: school } = await supabase.from("schools").select("name, logo_url, primary_color, address, phone").eq("id", schoolId).maybeSingle();

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
    };
  });

  // Alphabetical by surname (the order the staff Report Cards page uses).
  const lastNameById = new Map((students as unknown as { id: string; last_name: string }[]).map((s) => [s.id, s.last_name]));
  return docs.sort((a, b) => (lastNameById.get(a.student.id) ?? "").localeCompare(lastNameById.get(b.student.id) ?? ""));
}
