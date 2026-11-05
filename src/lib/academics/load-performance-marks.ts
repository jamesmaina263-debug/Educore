import type { createClient } from "@/lib/supabase/server";
import { selectAllPages } from "@/lib/academics/in-chunks";
import type { PerfMark } from "@/lib/academics/performance-analytics";

// Read-only loader for the Academic Performance Analytics module. It runs through the caller's own
// Supabase session, so existing RLS (school scoping, guardian/student/teacher visibility) decides which
// marks come back; no permission logic or service role lives here. Only numeric-model marks from CLOSED
// exams are returned: open exams are still being entered and would make a year look weaker than it is,
// and CBC band marks have no percentage. Each mark's maximum comes from the exam_subjects row it already
// references, so papers out of different totals are normalised by the pure layer.

type Client = Awaited<ReturnType<typeof createClient>>;
interface TermShape {
  term_number: number;
  academic_years: { id: string; name: string; start_date: string } | { id: string; name: string; start_date: string }[] | null;
}
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

interface Row {
  student_id: string;
  class_id: string;
  subject_id: string;
  exam_id: string;
  raw_score: number | null;
  subjects: { name: string } | { name: string }[] | null;
  classes: { name: string } | { name: string }[] | null;
  exam_subjects: { max_score: number } | { max_score: number }[] | null;
  exams:
    | { terms: { term_number: number; academic_years: { id: string; name: string; start_date: string } | { id: string; name: string; start_date: string }[] | null } | null }
    | null;
}

export async function loadPerformanceMarks(supabase: Client, opts: { studentId?: string } = {}): Promise<PerfMark[]> {
  const rows = await selectAllPages<Row>((from, to) => {
    let q = supabase
      .from("marks")
      .select(
        "student_id, class_id, subject_id, exam_id, raw_score, subjects(name), classes(name), exam_subjects(max_score), exams!inner(status, terms(term_number, academic_years(id, name, start_date)))",
      )
      .eq("exams.status", "closed")
      .not("raw_score", "is", null);
    if (opts.studentId) q = q.eq("student_id", opts.studentId);
    return q.order("id", { ascending: true }).range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
  });

  const out: PerfMark[] = [];
  for (const r of rows) {
    const term = (r.exams as unknown as { terms: TermShape | null } | null)?.terms ?? null;
    const year = one(term?.academic_years ?? null);
    if (!term || !year) continue;
    out.push({
      studentId: r.student_id,
      classId: r.class_id,
      classLabel: one(r.classes)?.name ?? "Unknown class",
      subjectId: r.subject_id,
      subjectName: one(r.subjects)?.name ?? "Unknown subject",
      yearId: year.id,
      yearName: year.name,
      yearStart: year.start_date,
      termNumber: term.term_number,
      examId: r.exam_id,
      rawScore: r.raw_score,
      maxScore: one(r.exam_subjects)?.max_score ?? null,
    });
  }
  return out;
}
