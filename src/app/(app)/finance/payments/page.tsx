import { loadFinanceContext } from "../_data";
import { FinancePageShell } from "@/components/finance/finance-page-shell";
import { PaymentsSection } from "@/components/finance/payments-section";
import { UnallocatedPaymentsSection } from "@/components/finance/unallocated-payments-section";

export default async function FinancePaymentsPage() {
  const ctx = await loadFinanceContext();
  return (
    <FinancePageShell ctx={ctx} section="Payments" title="Payments">
      <div className="flex flex-col gap-6">
        <PaymentsSection payments={ctx.paymentRows} canReverse={ctx.canWrite} />

        <div>
          <p className="mb-2 text-sm font-semibold">
            Unallocated Payments{ctx.unallocatedRows.length > 0 ? ` (${ctx.unallocatedRows.length})` : ""}
          </p>
          <UnallocatedPaymentsSection payments={ctx.unallocatedRows} canWrite={ctx.canWrite} />
        </div>
      </div>
    </FinancePageShell>
  );
}
