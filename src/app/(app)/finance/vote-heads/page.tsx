import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { loadFinanceContext } from "../_data";
import { FinancePageShell } from "@/components/finance/finance-page-shell";
import {
  VoteHeadsSection,
  type MappingRow,
  type ReconciliationView,
  type VoteHeadOption,
} from "@/components/finance/vote-heads-section";
import {
  VOTE_HEAD_FLAG,
  reconciles,
  totalsByKind,
  unmappedNames,
  type LedgerLine,
  type MappingSource,
  type VoteHeadKind,
} from "@/lib/vote-heads";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function VoteHeadsPage({ searchParams }: { searchParams: Promise<{ term?: string }> }) {
  const supabase = await createClient();

  // Hidden entirely unless the school has the flag. hasFeatureFlag fails closed (any error => false).
  if (!(await hasFeatureFlag(supabase, VOTE_HEAD_FLAG))) notFound();

  const { term } = await searchParams;
  const termId = term && UUID_RE.test(term) ? term : null;
  const ctx = await loadFinanceContext([]);

  let ledger: LedgerLine[] = [];
  let reconciliation: ReconciliationView | null = null;
  let heads: VoteHeadOption[] = [];
  let mappings: MappingRow[] = [];
  let unmappedItems: string[] = [];
  let unmappedCategories: string[] = [];

  if (ctx.canRead) {
    const { data: ledgerRows } = await supabase.rpc("vote_head_ledger", { p_term_id: termId });
    ledger = ((ledgerRows ?? []) as { vote_head_id: string | null; code: string; name: string; kind: string; lines: number | string; amount: number | string }[]).map((r) => ({
      voteHeadId: r.vote_head_id,
      code: r.code,
      name: r.name,
      kind: r.kind as VoteHeadKind,
      lines: Number(r.lines),
      amount: Number(r.amount),
    }));

    const { data: recRows } = await supabase.rpc("vote_head_reconciliation", { p_term_id: termId });
    const rec = ((recRows ?? []) as Record<string, number | string>[])[0];
    if (rec) {
      reconciliation = {
        invoicedTotal: Number(rec.invoiced_total),
        incomeLedgerTotal: Number(rec.income_ledger_total),
        incomeDifference: Number(rec.income_difference),
        approvedExpenseTotal: Number(rec.approved_expense_total),
        expenseLedgerTotal: Number(rec.expense_ledger_total),
        expenseDifference: Number(rec.expense_difference),
      };
    }

    const { data: headRows } = await supabase.from("vote_heads").select("id, code, name, kind, is_active").order("code");
    heads = (headRows ?? []).map((h) => ({ id: h.id as string, code: h.code as string, name: h.name as string, kind: h.kind as VoteHeadKind, isActive: h.is_active as boolean }));
    const codeById = new Map(heads.map((h) => [h.id, h.code]));

    const { data: mapRows } = await supabase.from("vote_head_mappings").select("source, match_key, vote_head_id").order("match_key");
    mappings = (mapRows ?? []).map((m) => ({ source: m.source as MappingSource, matchKey: m.match_key as string, voteHeadCode: codeById.get(m.vote_head_id as string) ?? "?" }));

    const keysFor = (s: MappingSource) => mappings.filter((m) => m.source === s).map((m) => m.matchKey);
    const { data: itemRows } = await supabase.from("invoice_items").select("name").limit(5000);
    unmappedItems = unmappedNames((itemRows ?? []).map((r) => r.name as string), keysFor("invoice_item"));
    const { data: catRows } = await supabase.from("expenses").select("category").eq("status", "approved").limit(5000);
    unmappedCategories = unmappedNames((catRows ?? []).map((r) => r.category as string), keysFor("expense_category"));
  }

  return (
    <FinancePageShell ctx={ctx} section="Vote Heads" title="Vote Heads" subtitle="Income and spending by vote head">
      <VoteHeadsSection
        canWrite={ctx.canWrite}
        terms={ctx.terms.map((t) => ({ id: t.id, name: t.name }))}
        termId={termId}
        ledger={ledger}
        totals={totalsByKind(ledger)}
        reconciliation={reconciliation}
        reconciled={reconciliation ? reconciles(reconciliation) : true}
        heads={heads}
        mappings={mappings}
        unmappedItems={unmappedItems}
        unmappedCategories={unmappedCategories}
      />
    </FinancePageShell>
  );
}
