import { createClient } from "@/lib/supabase/server";
import { escapePostgrestOrValue } from "@/lib/postgrest-filter";
import { createBedLabelResolver } from "./bed-label";
import type { TransferRow } from "@/components/boarding/transfers-section";

export interface TransfersPageParams {
  search?: string;
  page: number;
  pageSize?: number;
}

export interface TransfersPageResult {
  rows: TransferRow[];
  totalCount: number;
}

/**
 * Paginated/searched replacement for boarding/_data.ts's transferTableRows
 * -- display-table only, same approach as getAllocationsPage. transferRows
 * inside loadBoardingContext is only used for transferTableRows and a
 * `.length` dashboard count, neither of which this touches.
 */
export async function getTransfersPage({
  search,
  page,
  pageSize = 25,
}: TransfersPageParams): Promise<TransfersPageResult> {
  const supabase = await createClient();
  const { bedLabel } = await createBedLabelResolver(supabase);

  let query = supabase
    .from("boarding_transfers")
    .select(
      "id, student_id, from_bed_id, to_bed_id, transfer_date, reason, students(first_name, last_name), authorizer:authorized_by(full_name)",
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

  const { data: transfers, count } = await query.order("transfer_date", { ascending: false }).range(from, to);

  const rows: TransferRow[] = (transfers ?? []).map((t) => {
    const st = t.students as unknown as { first_name: string; last_name: string } | null;
    const authorizer = t.authorizer as unknown as { full_name: string } | null;
    return {
      id: t.id,
      student_name: st ? `${st.first_name} ${st.last_name}` : "",
      from_bed_label: t.from_bed_id ? bedLabel(t.from_bed_id) : null,
      to_bed_label: bedLabel(t.to_bed_id),
      transfer_date: t.transfer_date,
      reason: t.reason,
      authorized_by_name: authorizer?.full_name ?? null,
    };
  });

  return { rows, totalCount: count ?? 0 };
}
