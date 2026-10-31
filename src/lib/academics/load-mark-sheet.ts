import type { createClient } from "@/lib/supabase/server";
import { selectAllPages } from "@/lib/academics/in-chunks";
import { buildMarkSheetModel, type MarkSheetModel } from "@/lib/academics/mark-sheet-model";
import { loadEnrolmentRows } from "@/lib/academics/load-subject-enrolment";
import { loadReportSettings } from "@/lib/academics/report-settings";

// Server-side loader for the Class Mark Sheet. Reads only, through the caller's own Supabase
// session, so existing RLS (exams.read, school scoping) decides what is visible; this adds no
// permission logic of its own and never touches the service role. It extends the same tables the
// Report Cards page already reads (exams, exam_subjects, marks, class_rankings, students) and
// hands the rows to the pure buildMarkSheetModel, where all calculation rules live.

type Client = Awaited<ReturnType<typeof createClient>>;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function loadMarkSheetModel(
  supabase: Client,
  args: { examId: string; classId: string; preparedBy: string | null },
): Promise<MarkSheetModel | null> {
  const { examId, classId } = args;
  const [{ data: exam }, { data: cls }, { data: examSubjects }, { data: streams }, marks, { data: rankings }] = await Promise.all([
    supabase.from("exams").select("name, exam_type, status, terms(name, academic_year_id, academic_years(name))").eq("id", examId).maybeSingle(),
    supabase.from("classes").select("name, school_id").eq("id", classId).maybeSingle(),
    supabase.from("exam_subjects").select("max_score, subjects(id, name)").eq("exam_id", examId).eq("class_id", classId),
    supabase.from("streams").select("id, name").eq("class_id", classId),
    // A class's marks are students x subjects rows, which passes the API's ~1000-row cap in a large
    // class and would silently drop marks from the sheet. Paged with a stable order (selectAllPages).
    selectAllPages<Record<string, unknown>>((from, to) =>
      supabase
        .from("marks")
        .select("student_id, subject_id, raw_score, grading_scale_bands(label, level_order)")
        .eq("exam_id", examId)
        .eq("class_id", classId)
        .order("student_id")
        .order("subject_id")
        .range(from, to),
    ),
    supabase.from("class_rankings").select("student_id, total_score, average_score, rank_in_stream, rank_in_class").eq("exam_id", examId).eq("class_id", classId),
  ]);
  if (!exam || !cls) return null;

  const streamRows = (streams ?? []) as { id: string; name: string }[];
  const streamName = new Map(streamRows.map((s) => [s.id, s.name]));
  const [{ data: students }, { data: school }, settings] = await Promise.all([
    streamRows.length
      ? supabase
          .from("students")
          .select("id, first_name, last_name, other_names, admission_number, current_class_id")
          .in("current_class_id", streamRows.map((s) => s.id))
          .eq("status", "active")
          .order("last_name")
      : Promise.resolve({ data: [] as never[] }),
    supabase.from("schools").select("name, motto, logo_url, address, phone, email, primary_color").eq("id", cls.school_id).maybeSingle(),
    loadReportSettings(supabase, cls.school_id as string),
  ]);

  const term = one(exam.terms as unknown as { name: string; academic_year_id?: string | null; academic_years: { name: string } | { name: string }[] | null } | null);
  const subjects = ((examSubjects ?? []) as unknown as { max_score: number; subjects: { id: string; name: string } | { id: string; name: string }[] | null }[])
    .flatMap((es) => {
      const s = one(es.subjects);
      return s ? [{ id: s.id, name: s.name, maxScore: Number(es.max_score) }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Which learners take which (selective) subjects. Empty for any school that has not set up electives, and
  // on any read problem, which means every learner takes every subject -- the behaviour before this existed.
  const enrolmentRows = await loadEnrolmentRows(supabase, {
    academicYearId: term?.academic_year_id,
    classIds: [classId],
    studentIds: ((students ?? []) as { id: string }[]).map((s) => s.id),
    subjectIds: subjects.map((s) => s.id),
  });

  return buildMarkSheetModel({
    school: {
      name: school?.name ?? "EduCore School",
      motto: school?.motto ?? null,
      logoUrl: school?.logo_url ?? null,
      address: school?.address ?? null,
      phone: school?.phone ?? null,
      email: school?.email ?? null,
      primaryColor: school?.primary_color ?? null,
    },
    exam: {
      name: exam.name as string,
      examType: exam.exam_type as string,
      status: exam.status as "open" | "closed",
      termName: term?.name ?? null,
      academicYearName: one(term?.academic_years)?.name ?? null,
    },
    classLabel: cls.name as string,
    subjects,
    students: ((students ?? []) as { id: string; first_name: string; last_name: string; other_names: string | null; admission_number: string; current_class_id: string }[]).map((s) => ({
      id: s.id,
      admissionNumber: s.admission_number,
      firstName: s.first_name,
      lastName: s.last_name,
      otherNames: s.other_names,
      streamName: streamName.get(s.current_class_id) ?? "",
    })),
    marks: ((marks ?? []) as unknown as { student_id: string; subject_id: string; raw_score: number | null; grading_scale_bands: { label: string; level_order: number } | { label: string; level_order: number }[] | null }[]).map((m) => {
      const band = one(m.grading_scale_bands);
      return { studentId: m.student_id, subjectId: m.subject_id, rawScore: m.raw_score === null ? null : Number(m.raw_score), bandLabel: band?.label ?? null, bandLevel: band?.level_order ?? null };
    }),
    rankings: ((rankings ?? []) as { student_id: string; total_score: number; average_score: number; rank_in_stream: number; rank_in_class: number }[]).map((r) => ({
      studentId: r.student_id,
      totalScore: Number(r.total_score),
      averageScore: Number(r.average_score),
      rankInStream: r.rank_in_stream,
      rankInClass: r.rank_in_class,
    })),
    enrolmentRows,
    generatedAt: new Date().toISOString(),
    preparedBy: args.preparedBy,
  },
  { rankingEnabled: settings.rankingEnabled, showSignatures: settings.showSignatures, showClassStatistics: settings.showClassStatistics });
}
