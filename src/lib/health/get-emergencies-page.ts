import { createClient } from "@/lib/supabase/server";
import { escapePostgrestOrValue } from "@/lib/postgrest-filter";
import type { EmergencyRow } from "@/components/health/emergencies-section";

export interface EmergenciesPageParams {
  search?: string;
  page: number;
  pageSize?: number;
}

export interface EmergenciesPageResult {
  rows: EmergencyRow[];
  totalCount: number;
}

/**
 * Paginated/searched replacement for health/_data.ts's emergencyTableRows
 * -- display-table only. emergencyRows inside loadHealthContext is only
 * used for emergencyTableRows and a 7-day-window dashboard count, neither
 * of which this touches.
 */
export async function getEmergenciesPage({
  search,
  page,
  pageSize = 25,
}: EmergenciesPageParams): Promise<EmergenciesPageResult> {
  const supabase = await createClient();

  let query = supabase
    .from("health_emergencies")
    .select(
      "id, student_id, incident_at, description, severity, action_taken, hospital_name, guardian_notified, students(first_name, last_name)",
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

  const { data: emergencies, count } = await query.order("incident_at", { ascending: false }).range(from, to);

  const rows: EmergencyRow[] = (emergencies ?? []).map((e) => {
    const st = e.students as unknown as { first_name: string; last_name: string } | null;
    return {
      id: e.id,
      student_name: st ? `${st.first_name} ${st.last_name}` : "",
      incident_at: e.incident_at,
      description: e.description,
      severity: e.severity as EmergencyRow["severity"],
      action_taken: e.action_taken,
      hospital_name: e.hospital_name,
      guardian_notified: e.guardian_notified,
    };
  });

  return { rows, totalCount: count ?? 0 };
}
