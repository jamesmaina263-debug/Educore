import { createClient } from "@/lib/supabase/server";
import { escapePostgrestOrValue } from "@/lib/postgrest-filter";
import type { BalanceRow } from "@/components/finance/balances-section";

export interface StudentBalancesPageParams {
  /** Matches first name, last name, or admission number. */
  search?: string;
  /** classes.id (grade level) -- resolved to its streams before filtering students. */
  classId?: string;
  /** 1-indexed. */
  page: number;
  pageSize?: number;
}

export interface StudentBalancesPageResult {
  rows: BalanceRow[];
  totalCount: number;
}

/**
 * Paginated, searched, class-filtered replacement for fetching every active
 * student + joining balances/references in JS (as loadFinanceContext's
 * activeStudents/balanceRows did). The `students` query itself is limited via
 * .range() and filtered at the DB level, so this never pulls more than
 * `pageSize` student rows regardless of school size -- the fetch this
 * unblocks is the one flagged as the real scale problem in PR #327/#328
 * (client-side fixes over a still-unpaginated fetch).
 *
 * v_student_balances and student_financial_accounts have no FK-recognized
 * relationship to students for PostgREST to embed, so they're fetched as a
 * second batch scoped to just this page's student ids (still ≤ pageSize rows
 * each) rather than a single embedded query.
 */
export async function getStudentBalancesPage({
  search,
  classId,
  page,
  pageSize = 25,
}: StudentBalancesPageParams): Promise<StudentBalancesPageResult> {
  const supabase = await createClient();

  let streamIds: string[] | null = null;
  if (classId) {
    const { data: streams } = await supabase.from("streams").select("id").eq("class_id", classId);
    streamIds = (streams ?? []).map((s) => s.id);
    if (streamIds.length === 0) {
      return { rows: [], totalCount: 0 };
    }
  }

  let query = supabase
    .from("students")
    .select("id, first_name, last_name, admission_number, current_class_id, streams(classes(name))", {
      count: "exact",
    })
    .eq("status", "active");

  if (streamIds) query = query.in("current_class_id", streamIds);

  const trimmedSearch = search?.trim();
  if (trimmedSearch) {
    const escaped = escapePostgrestOrValue(`%${trimmedSearch}%`);
    query = query.or(
      `first_name.ilike.${escaped},last_name.ilike.${escaped},admission_number.ilike.${escaped}`,
    );
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data: students, count } = await query.order("first_name").range(from, to);
  const studentIds = (students ?? []).map((s) => s.id);

  if (studentIds.length === 0) {
    return { rows: [], totalCount: count ?? 0 };
  }

  const [{ data: balances }, { data: accounts }] = await Promise.all([
    supabase
      .from("v_student_balances")
      .select("student_id, total_invoiced, total_discounted, total_paid, balance, credit_balance")
      .in("student_id", studentIds),
    supabase.from("student_financial_accounts").select("student_id, payment_reference").in("student_id", studentIds),
  ]);

  const balanceByStudent = new Map((balances ?? []).map((b) => [b.student_id, b]));
  const referenceByStudent = new Map((accounts ?? []).map((a) => [a.student_id, a.payment_reference]));

  const rows: BalanceRow[] = (students ?? []).map((s) => {
    const b = balanceByStudent.get(s.id);
    const className =
      (s.streams as unknown as { classes: { name: string } | null } | null)?.classes?.name ?? "";
    return {
      student_id: s.id,
      full_name: `${s.first_name} ${s.last_name}`,
      admission_number: s.admission_number ?? "",
      payment_reference: referenceByStudent.get(s.id) ?? null,
      class_name: className,
      total_invoiced: Number(b?.total_invoiced ?? 0),
      total_discounted: Number(b?.total_discounted ?? 0),
      total_paid: Number(b?.total_paid ?? 0),
      balance: Number(b?.balance ?? 0),
      credit_balance: Number(b?.credit_balance ?? 0),
    };
  });

  return { rows, totalCount: count ?? 0 };
}
