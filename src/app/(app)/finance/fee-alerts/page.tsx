import { createClient } from "@/lib/supabase/server";
import { loadFinanceContext } from "../_data";
import { FinancePageShell } from "@/components/finance/finance-page-shell";
import { FeeAlertsSection, type FeeAlertRow } from "@/components/finance/fee-alerts-section";

export default async function FinanceFeeAlertsPage() {
  const ctx = await loadFinanceContext();
  const supabase = await createClient();

  const { data: alertRows } = ctx.canRead
    ? await supabase
        .from("fee_threshold_alerts")
        .select(
          "id, balance_at_generation, threshold_at_generation, draft_body, ai_drafted, status, generated_at, sent_at, students(first_name, last_name), school_users!fee_threshold_alerts_guardian_user_id_fkey(full_name, phone, email)",
        )
        .order("generated_at", { ascending: false })
        .limit(200)
    : { data: null };

  const alerts: FeeAlertRow[] = (alertRows ?? []).map((r) => {
    const student = r.students as unknown as { first_name: string; last_name: string } | null;
    const guardian = r.school_users as unknown as { full_name: string; phone: string | null; email: string | null } | null;
    return {
      id: r.id as string,
      studentName: student ? `${student.first_name} ${student.last_name}` : "Unknown student",
      guardianName: guardian?.full_name ?? "Unknown guardian",
      guardianContact: guardian?.phone ?? guardian?.email ?? "No contact on file",
      balance: Number(r.balance_at_generation),
      threshold: Number(r.threshold_at_generation),
      draftBody: r.draft_body as string,
      aiDrafted: r.ai_drafted as boolean,
      status: r.status as FeeAlertRow["status"],
      generatedAt: r.generated_at as string,
      sentAt: r.sent_at as string | null,
    };
  });

  return (
    <FinancePageShell ctx={ctx} section="Fee Alerts" title="Fee Alerts" subtitle="Draft-and-approve fee arrears reminders">
      <FeeAlertsSection
        alerts={alerts}
        threshold={ctx.feeAlertThreshold}
        canWrite={ctx.canWrite}
      />
    </FinancePageShell>
  );
}
