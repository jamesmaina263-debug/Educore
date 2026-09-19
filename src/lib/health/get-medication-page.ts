import { createClient } from "@/lib/supabase/server";
import { escapePostgrestOrValue } from "@/lib/postgrest-filter";
import type { MedicationRow } from "@/components/health/medication-section";

export interface MedicationPageParams {
  search?: string;
  page: number;
  pageSize?: number;
}

export interface MedicationPageResult {
  rows: MedicationRow[];
  totalCount: number;
}

/**
 * Paginated/searched replacement for health/_data.ts's medicationTableRows
 * -- display-table only. medicationRows inside loadHealthContext is only
 * used for medicationTableRows and a `.length`/date-filtered dashboard
 * count, neither of which this touches.
 */
export async function getMedicationPage({
  search,
  page,
  pageSize = 25,
}: MedicationPageParams): Promise<MedicationPageResult> {
  const supabase = await createClient();

  let query = supabase
    .from("medication_administrations")
    .select(
      "id, student_id, medication_name, dosage, route, administered_at, quantity_administered, students(first_name, last_name), administrator:administered_by(full_name)",
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

  const { data: administrations, count } = await query
    .order("administered_at", { ascending: false })
    .range(from, to);

  const rows: MedicationRow[] = (administrations ?? []).map((m) => {
    const st = m.students as unknown as { first_name: string; last_name: string } | null;
    const administrator = m.administrator as unknown as { full_name: string } | null;
    return {
      id: m.id,
      student_name: st ? `${st.first_name} ${st.last_name}` : "",
      medication_name: m.medication_name,
      dosage: m.dosage,
      route: m.route,
      quantity_administered: m.quantity_administered,
      administered_at: m.administered_at,
      administered_by_name: administrator?.full_name ?? null,
    };
  });

  return { rows, totalCount: count ?? 0 };
}
