import type { createClient } from "@/lib/supabase/server";
import type { EnrolmentRow } from "@/lib/academics/subject-enrolment";

// Reads student_subjects through the caller's own Supabase session, so existing RLS (academics.read, school
// scoping) decides what is visible. Reads only; never the service role.
//
// It can never make a page worse than today: ANY problem (no academic year, a failed or thrown query, a
// result that might be truncated) returns [], which the rules in subject-enrolment.ts treat as "every
// student takes every subject", exactly the behaviour before this table existed.
//
// Cost on the common path (a school with no electives set up): one tiny probe query, then nothing.

type Client = Awaited<ReturnType<typeof createClient>>;

const STUDENT_CHUNK = 100; // keeps the request URL short for large classes
const PAGE_SIZE = 1000; // the API caps a response at 1000 rows and truncates silently, so page explicitly
const MAX_PAGES_PER_CHUNK = 20;

type RawRow = { student_id: string; subject_id: string; is_active: boolean };

export async function loadEnrolmentRows(
  supabase: Client,
  args: { academicYearId: string | null | undefined; studentIds: string[]; subjectIds: string[] },
): Promise<EnrolmentRow[]> {
  const { academicYearId } = args;
  const studentIds = [...new Set(args.studentIds)];
  const subjectIds = [...new Set(args.subjectIds)];
  if (!academicYearId || studentIds.length === 0 || subjectIds.length === 0) return [];

  try {
    const probe = await supabase.from("student_subjects").select("id").eq("academic_year_id", academicYearId).limit(1);
    if (probe.error) {
      console.error("student_subjects probe failed; treating every student as taking every subject:", probe.error.message);
      return [];
    }
    if (!probe.data || probe.data.length === 0) return [];

    const chunks: string[][] = [];
    for (let i = 0; i < studentIds.length; i += STUDENT_CHUNK) chunks.push(studentIds.slice(i, i + STUDENT_CHUNK));

    const perChunk = await Promise.all(
      chunks.map(async (chunk) => {
        const out: RawRow[] = [];
        for (let page = 0; page < MAX_PAGES_PER_CHUNK; page += 1) {
          const from = page * PAGE_SIZE;
          const res = await supabase
            .from("student_subjects")
            .select("student_id, subject_id, is_active")
            .eq("academic_year_id", academicYearId)
            .in("subject_id", subjectIds)
            .in("student_id", chunk)
            .order("id")
            .range(from, from + PAGE_SIZE - 1);
          if (res.error) throw new Error(res.error.message);
          const rows = (res.data ?? []) as RawRow[];
          out.push(...rows);
          if (rows.length < PAGE_SIZE) return out;
        }
        // Still full after the page limit: the list may be incomplete, so do not use any of it.
        throw new Error("student_subjects result exceeded the page limit");
      }),
    );

    return perChunk.flat().map((r) => ({ studentId: r.student_id, subjectId: r.subject_id, isActive: r.is_active === true }));
  } catch (err) {
    // All-or-nothing: a partial list would make some students look un-enrolled.
    console.error("student_subjects read failed; treating every student as taking every subject:", err instanceof Error ? err.message : err);
    return [];
  }
}
