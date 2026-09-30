import { createClient } from "@/lib/supabase/server";
import { escapePostgrestOrValue } from "@/lib/postgrest-filter";
import type { IncidentRow } from "@/components/boarding/incidents-section";

export interface IncidentsPageParams {
  search?: string;
  page: number;
  pageSize?: number;
}

export interface IncidentsPageResult {
  rows: IncidentRow[];
  totalCount: number;
}

/**
 * Paginated/searched replacement for boarding/_data.ts's incidentTableRows
 * -- display-table only. incidentRows inside loadBoardingContext is only
 * used for incidentTableRows itself, no other business logic reads it, so
 * unlike allocations there's nothing else to preserve here.
 */
export async function getIncidentsPage({
  search,
  page,
  pageSize = 25,
}: IncidentsPageParams): Promise<IncidentsPageResult> {
  const supabase = await createClient();

  let query = supabase
    .from("boarding_incidents")
    .select(
      "id, student_id, incident_type, incident_date, location, description, action_taken, follow_up, status, students(first_name, last_name), school_users(full_name)",
      { count: "exact" },
    );

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

  const { data: incidents, count } = await query.order("incident_date", { ascending: false }).range(from, to);

  const rows: IncidentRow[] = (incidents ?? []).map((i) => {
    const st = i.students as unknown as { first_name: string; last_name: string } | null;
    const staff = i.school_users as unknown as { full_name: string } | null;
    return {
      id: i.id,
      student_name: st ? `${st.first_name} ${st.last_name}` : "",
      incident_type: i.incident_type,
      incident_date: i.incident_date,
      location: i.location,
      description: i.description,
      staff_name: staff?.full_name ?? null,
      action_taken: i.action_taken,
      follow_up: i.follow_up,
      status: i.status as "open" | "closed",
    };
  });

  return { rows, totalCount: count ?? 0 };
}
