import { loadFinanceContext } from "../_data";
import { getPaymentsPage } from "@/lib/finance/get-payments-page";
import { FinancePageShell } from "@/components/finance/finance-page-shell";
import { PaymentsSection } from "@/components/finance/payments-section";
import { UnallocatedPaymentsSection } from "@/components/finance/unallocated-payments-section";

const PAGE_SIZE = 25;

export default async function FinancePaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const [ctx, { rows, totalCount }] = await Promise.all([
    loadFinanceContext(),
    getPaymentsPage({ search: q, page, pageSize: PAGE_SIZE }),
  ]);

  return (
    <FinancePageShell ctx={ctx} section="Payments" title="Payments">
      <div className="flex flex-col gap-6">
        <PaymentsSection payments={rows} totalCount={totalCount} pageSize={PAGE_SIZE} canReverse={ctx.canWrite} />

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
