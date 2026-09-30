import { createClient } from "@/lib/supabase/server";
import { escapePostgrestOrValue } from "@/lib/postgrest-filter";
import { getGuardiansForStudents } from "./guardians";
import type { SickBayVisitRow } from "@/components/health/sick-bay-section";

export interface SickBayPageParams {
  search?: string;
  /** "open" (default) matches the page's original default view ("currently in sick bay"); "all" is the "Show full history" toggle. */
  status?: "open" | "all";
  page: number;
  pageSize?: number;
}

export interface SickBayPageResult {
  rows: SickBayVisitRow[];
  totalCount: number;
}

/**
 * Paginated/searched replacement for health/_data.ts's sickBayTableRows --
 * display-table only. Does not touch loadHealthContext, which still fetches
 * every sick_bay_visits row unpaginated for dashboard stats (visitsToday,
 * inSickBayNow, recentActivity, totalVisitsThisTerm).
 *
 * The default view previously showed only currently-open visits
 * (v.is_open, i.e. check_out_at === null) regardless of history depth --
 * replicated here as a real `.is("check_out_at", null)` filter rather than
 * a client-side .filter() over a fully-loaded array, same approach as
 * boarding's getAllocationsPage "active" status param.
 */
export async function getSickBayPage({
  search,
  status = "open",
  page,
  pageSize = 25,
}: SickBayPageParams): Promise<SickBayPageResult> {
  const supabase = await createClient();

  let query = supabase
    .from("sick_bay_visits")
    .select(
      "id, student_id, check_in_at, reason, symptoms, temperature_c, check_out_at, outcome, students(first_name, last_name)",
      { count: "exact" },
    );

  if (status === "open") {
    query = query.is("check_out_at", null);
  }

  const trimmedSearch = search?.trim();
  if (trimmedSearch) {
    const escaped = escapePostgrestOrValue(`%${trimmedSearch}%`);
    const { data: matchingStudents } = await supabase
      .from("students")
      .select("id")
      .or(`first_name.ilike.${escaped},last_name.ilike.${escaped},admission_number.ilike.${escaped}`);
    if (!matchingStudents || matchingStudents.length === 0) {
      return { rows: [], totalCount: 0 };
    }
    query = query.in("student_id", matchingStudents.map((s) => s.id));
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data: visits, count } = await query.order("check_in_at", { ascending: false }).range(from, to);
  const studentIds = (visits ?? []).map((v) => v.student_id);
  const guardiansByStudent = await getGuardiansForStudents(supabase, studentIds);

  const rows: SickBayVisitRow[] = (visits ?? []).map((v) => {
    const st = v.students as unknown as { first_name: string; last_name: string } | null;
    return {
      id: v.id,
      student_id: v.student_id,
      student_name: st ? `${st.first_name} ${st.last_name}` : "",
      check_in_at: v.check_in_at,
      reason: v.reason,
      symptoms: v.symptoms,
      temperature_c: v.temperature_c,
      check_out_at: v.check_out_at,
      outcome: v.outcome,
      is_open: v.check_out_at === null,
      guardians: guardiansByStudent.get(v.student_id) ?? [],
    };
  });

  return { rows, totalCount: count ?? 0 };
}
