import { loadFinanceContext } from "../_data";
import { FinancePageShell } from "@/components/finance/finance-page-shell";
import { DiscountsSection } from "@/components/finance/discounts-section";
import { WaiversSection } from "@/components/finance/waivers-section";

export default async function FinanceDiscountsWaiversPage() {
  const ctx = await loadFinanceContext();
  return (
    <FinancePageShell ctx={ctx} section="Discounts & Waivers" title="Discounts & Waivers">
      <div className="flex flex-col gap-6">
        <div>
          <p className="mb-2 text-sm font-semibold">Discounts</p>
          <DiscountsSection
            discounts={ctx.discountRows}
            invoiceOptions={ctx.invoiceOptions}
            canRequest={ctx.canWrite}
            canApprove={ctx.canApproveDiscounts}
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold">Waivers</p>
          <WaiversSection
            waivers={ctx.waiverRows}
            students={ctx.studentOptions}
            terms={ctx.termOptions}
            canManage={ctx.canApproveDiscounts}
          />
        </div>
      </div>
    </FinancePageShell>
  );
}
