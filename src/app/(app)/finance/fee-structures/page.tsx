import { loadFinanceContext } from "../_data";
import { FinancePageShell } from "@/components/finance/finance-page-shell";
import { FeeStructuresSection } from "@/components/finance/fee-structures-section";

export default async function FinanceFeeStructuresPage() {
  const ctx = await loadFinanceContext();
  return (
    <FinancePageShell ctx={ctx} section="Fee Structures" title="Fee Structures">
      <FeeStructuresSection
        structures={ctx.structureRows}
        academicYearId={ctx.activeYearId}
        terms={ctx.terms.map((t) => ({ id: t.id, name: t.name }))}
        classes={ctx.classes}
        canWrite={ctx.canWrite}
      />
    </FinancePageShell>
  );
}
