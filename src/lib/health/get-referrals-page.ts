import { createClient } from "@/lib/supabase/server";
import { escapePostgrestOrValue } from "@/lib/postgrest-filter";
import type { ReferralRow } from "@/components/health/referrals-section";

export interface ReferralsPageParams {
  search?: string;
  page: number;
  pageSize?: number;
}

export interface ReferralsPageResult {
  rows: ReferralRow[];
  totalCount: number;
}

/**
 * Paginated/searched replacement for health/_data.ts's referralTableRows --
 * display-table only. referralRows inside loadHealthContext is only used
 * for referralTableRows and a `status === "pending"` dashboard count,
 * neither of which this touches.
 */
export async function getReferralsPage({
  search,
  page,
  pageSize = 25,
}: ReferralsPageParams): Promise<ReferralsPageResult> {
  const supabase = await createClient();

  let query = supabase
    .from("health_referrals")
    .select(
      "id, student_id, referred_to, reason, referral_date, status, guardian_notified, outcome_notes, students(first_name, last_name)",
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

  const { data: referrals, count } = await query.order("referral_date", { ascending: false }).range(from, to);

  const rows: ReferralRow[] = (referrals ?? []).map((r) => {
    const st = r.students as unknown as { first_name: string; last_name: string } | null;
    return {
      id: r.id,
      student_name: st ? `${st.first_name} ${st.last_name}` : "",
      referred_to: r.referred_to,
      reason: r.reason,
      referral_date: r.referral_date,
      status: r.status as ReferralRow["status"],
      guardian_notified: r.guardian_notified,
      outcome_notes: r.outcome_notes,
    };
  });

  return { rows, totalCount: count ?? 0 };
}
