import { loadFinanceContext } from "../_data";
import { createClient } from "@/lib/supabase/server";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { FinancePageShell } from "@/components/finance/finance-page-shell";
import { InvoicesSection } from "@/components/finance/invoices-section";

export default async function FinanceInvoicingPage() {
  const ctx = await loadFinanceContext();
  const payByLinkEnabled = await hasFeatureFlag(await createClient(), "feature.finance.pay_by_link");
  return (
    <FinancePageShell ctx={ctx} section="Invoicing" title="Invoicing">
      <InvoicesSection
        invoices={ctx.invoiceRows}
        canWrite={ctx.canWrite}
        schoolName={ctx.schoolName}
        mpesaActive={ctx.mpesaActive}
        payByLinkEnabled={payByLinkEnabled}
      />
    </FinancePageShell>
  );
}
