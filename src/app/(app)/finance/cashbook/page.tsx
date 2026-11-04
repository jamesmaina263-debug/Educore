import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { loadFinanceContext } from "../_data";
import { FinancePageShell } from "@/components/finance/finance-page-shell";
import { CashbookSection } from "@/components/finance/cashbook-section";
import {
  CASHBOOK_FLAG,
  ENTRY_LIMIT,
  isTruncated,
  resolveWindow,
  summaryTotals,
  type CashbookAccountSummary,
  type CashbookEntry,
  type CashbookKind,
  type CashbookReconciliation,
} from "@/lib/cashbook";

export default async function CashbookPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const supabase = await createClient();

  // Hidden entirely unless the school has the flag. hasFeatureFlag fails closed (any error => false).
  if (!(await hasFeatureFlag(supabase, CASHBOOK_FLAG))) notFound();

  const params = await searchParams;
  const { from, to } = resolveWindow(params.from, params.to);
  const ctx = await loadFinanceContext([]);

  let summary: CashbookAccountSummary[] = [];
  let entries: CashbookEntry[] = [];
  let reconciliation: CashbookReconciliation | null = null;

  if (ctx.canRead) {
    const { data: sumRows, error: sumError } = await supabase.rpc("cashbook_summary", { p_from: from, p_to: to });
    if (sumError) {
      console.error("[cashbook] summary failed", sumError);
      throw new Error("Failed to load the cashbook. Please try again.");
    }
    summary = ((sumRows ?? []) as Record<string, number | string>[]).map((r) => ({
      account: String(r.account),
      opening: Number(r.opening),
      moneyIn: Number(r.money_in),
      moneyOut: Number(r.money_out),
      closing: Number(r.closing),
      entries: Number(r.entries),
    }));

    const { data: entryRows, error: entryError } = await supabase.rpc("cashbook_entries", {
      p_from: from,
      p_to: to,
      p_limit: ENTRY_LIMIT,
    });
    if (entryError) {
      console.error("[cashbook] entries failed", entryError);
      throw new Error("Failed to load the cashbook. Please try again.");
    }
    entries = ((entryRows ?? []) as Record<string, string | number | null>[]).map((r) => ({
      entryDate: String(r.entry_date),
      kind: r.kind as CashbookKind,
      account: String(r.account),
      reference: (r.reference as string | null) ?? null,
      description: String(r.description),
      moneyIn: Number(r.money_in),
      moneyOut: Number(r.money_out),
      sourceId: String(r.source_id),
    }));

    const { data: recRows } = await supabase.rpc("cashbook_reconciliation");
    const rec = ((recRows ?? []) as Record<string, number | string>[])[0];
    if (rec) {
      reconciliation = {
        receiptsDifference: Number(rec.receipts_difference),
        reversalsDifference: Number(rec.reversals_difference),
        expensesDifference: Number(rec.expenses_difference),
      };
    }
  }

  return (
    <FinancePageShell ctx={ctx} section="Cashbook" title="Cashbook" subtitle="Money received and paid out, in date order">
      <CashbookSection
        from={from}
        to={to}
        summary={summary}
        entries={entries}
        reconciliation={reconciliation}
        truncated={isTruncated(summaryTotals(summary).entries, entries.length)}
        limit={ENTRY_LIMIT}
      />
    </FinancePageShell>
  );
}
