import { createClient } from "@/lib/supabase/server";
import { escapePostgrestOrValue } from "@/lib/postgrest-filter";
import { createBedLabelResolver } from "./bed-label";
import type { AllocationRow } from "@/components/boarding/allocation-section";

export interface AllocationsPageParams {
  search?: string;
  /** "active" (default) matches the page's original default view; "all" is the "Show full history" toggle. */
  status?: "active" | "all";
  page: number;
  pageSize?: number;
}

export interface AllocationsPageResult {
  rows: AllocationRow[];
  totalCount: number;
}

/**
 * Paginated/searched replacement for boarding/_data.ts's allocationTableRows
 * -- used ONLY for the Allocation history table display. Does not touch (or
 * replace) loadBoardingContext, which still fetches every hostel_allocations
 * row unpaginated for bed-occupancy (activeAllocationByBed), current-roster
 * (boardedIds/rollCallStudents), and dashboard-count logic -- that pipeline
 * stays exactly as-is; this is purely an additional, separate query for the
 * table view, same approach as getStudentBalancesPage/getPaymentsPage.
 */
export async function getAllocationsPage({
  search,
  status = "active",
  page,
  pageSize = 25,
}: AllocationsPageParams): Promise<AllocationsPageResult> {
  const supabase = await createClient();
  const { bedLabel } = await createBedLabelResolver(supabase);

  let query = supabase
    .from("hostel_allocations")
    .select("id, student_id, bed_id, start_date, end_date, status, students(first_name, last_name)", {
      count: "exact",
    });

  if (status === "active") {
    query = query.eq("status", "active");
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
    // Student ids are our own DB-generated UUIDs, never user input.
    query = query.in("student_id", matchingStudents.map((s) => s.id));
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data: allocations, count } = await query.order("start_date", { ascending: false }).range(from, to);

  const rows: AllocationRow[] = (allocations ?? []).map((a) => {
    const st = a.students as unknown as { first_name: string; last_name: string } | null;
    return {
      id: a.id,
      student_name: st ? `${st.first_name} ${st.last_name}` : "",
      bed_label: bedLabel(a.bed_id),
      start_date: a.start_date,
      end_date: a.end_date,
      status: a.status as "active" | "ended",
    };
  });

  return { rows, totalCount: count ?? 0 };
}
