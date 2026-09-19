import { createClient } from "@/lib/supabase/server";
import { escapePostgrestOrValue } from "@/lib/postgrest-filter";
import type { PaymentListRow } from "@/components/finance/payments-section";

export interface PaymentsPageParams {
  /** Matches payment reference OR the paying student's name/admission number. */
  search?: string;
  /** 1-indexed. */
  page: number;
  pageSize?: number;
}

export interface PaymentsPageResult {
  rows: PaymentListRow[];
  totalCount: number;
}

/**
 * Paginated, searched replacement for loadFinanceContext's unfiltered
 * `payments` fetch (every non-reversed/non-unallocated payment the school
 * has ever recorded, every page load). Same approach as
 * getStudentBalancesPage: .range() at the DB level, second small batch
 * queries (receipts/payment_reversals) scoped to just this page's payment
 * ids rather than the whole table.
 *
 * Search needs to match either a same-table column (reference) or the
 * joined student's name/admission_number -- PostgREST's .or() can't filter
 * embedded-relation columns directly, so a matching-student-ids lookup runs
 * first and gets folded into the same .or() as an `.in.(...)` clause
 * alongside the reference match.
 */
export async function getPaymentsPage({
  search,
  page,
  pageSize = 25,
}: PaymentsPageParams): Promise<PaymentsPageResult> {
  const supabase = await createClient();

  let query = supabase
    .from("payments")
    .select(
      "id, student_id, method, amount, reference, purpose, notes, status, phone_number, recorded_at, students(first_name, last_name)",
      { count: "exact" },
    )
    .neq("status", "unallocated");

  const trimmedSearch = search?.trim();
  if (trimmedSearch) {
    const escaped = escapePostgrestOrValue(`%${trimmedSearch}%`);

    const { data: matchingStudents } = await supabase
      .from("students")
      .select("id")
      .or(`first_name.ilike.${escaped},last_name.ilike.${escaped},admission_number.ilike.${escaped}`);

    const clauses = [`reference.ilike.${escaped}`];
    if (matchingStudents && matchingStudents.length > 0) {
      // Student ids are our own DB-generated UUIDs, never user input --
      // safe to inline into the .in.() clause.
      clauses.push(`student_id.in.(${matchingStudents.map((s) => s.id).join(",")})`);
    }
    query = query.or(clauses.join(","));
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data: payments, count } = await query.order("recorded_at", { ascending: false }).range(from, to);
  const paymentIds = (payments ?? []).map((p) => p.id);

  if (paymentIds.length === 0) {
    return { rows: [], totalCount: count ?? 0 };
  }

  const [{ data: receipts }, { data: reversals }] = await Promise.all([
    supabase.from("receipts").select("payment_id, receipt_number").in("payment_id", paymentIds),
    supabase.from("payment_reversals").select("payment_id, amount").in("payment_id", paymentIds),
  ]);

  const receiptByPayment = new Map((receipts ?? []).map((r) => [r.payment_id, r.receipt_number]));
  const reversedByPayment = new Map<string, number>();
  for (const r of reversals ?? []) {
    reversedByPayment.set(r.payment_id, (reversedByPayment.get(r.payment_id) ?? 0) + Number(r.amount));
  }

  const rows: PaymentListRow[] = (payments ?? []).map((p) => {
    const st = p.students as unknown as { first_name: string; last_name: string } | null;
    return {
      id: p.id,
      student_name: st ? `${st.first_name} ${st.last_name}` : "",
      method: p.method as PaymentListRow["method"],
      amount: Number(p.amount),
      reference: p.reference,
      purpose: p.purpose,
      status: p.status as PaymentListRow["status"],
      receipt_number: receiptByPayment.get(p.id) ?? null,
      reversed_total: reversedByPayment.get(p.id) ?? 0,
      recorded_at: p.recorded_at,
    };
  });

  return { rows, totalCount: count ?? 0 };
}
