import { createClient } from "@/lib/supabase/server";
import { loadFinanceContext } from "../_data";
import { FinancePageShell } from "@/components/finance/finance-page-shell";
import { ReconciliationSection, type StatementBatchRow } from "@/components/finance/reconciliation-section";

export default async function FinanceReconciliationPage() {
  const ctx = await loadFinanceContext();
  const supabase = await createClient();

  let batches: StatementBatchRow[] = [];
  if (ctx.canRead) {
    const { data } = await supabase
      .from("mpesa_statement_batches")
      .select("id, source_label, total_lines, matched_count, mismatched_count, not_in_system_count, created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    batches = (data ?? []) as StatementBatchRow[];
  }

  return (
    <FinancePageShell
      ctx={ctx}
      section="Reconciliation"
      title="M-Pesa Reconciliation"
      subtitle="Match a Paybill statement against payments already recorded in the system"
    >
      <ReconciliationSection initialBatches={batches} canWrite={ctx.canWrite} />
    </FinancePageShell>
  );
}
