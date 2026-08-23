import { loadFinanceContext } from "../_data";
import { FinancePageShell } from "@/components/finance/finance-page-shell";
import { InvoicesSection } from "@/components/finance/invoices-section";

export default async function FinanceInvoicingPage() {
  const ctx = await loadFinanceContext();
  return (
    <FinancePageShell ctx={ctx} section="Invoicing" title="Invoicing">
      <InvoicesSection
        invoices={ctx.invoiceRows}
        canWrite={ctx.canWrite}
        schoolName={ctx.schoolName}
        mpesaActive={ctx.mpesaActive}
      />
    </FinancePageShell>
  );
}
