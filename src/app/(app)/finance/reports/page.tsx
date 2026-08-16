import { loadFinanceContext, kes } from "../_data";
import { FinancePageShell } from "@/components/finance/finance-page-shell";
import { FinanceReportExports } from "@/components/finance/finance-report-exports";

export default async function FinanceReportsPage() {
  const ctx = await loadFinanceContext();

  return (
    <FinancePageShell ctx={ctx} section="Finance Reports" title="Finance Reports">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="panel px-4 py-3">
          <p className="label-eyebrow">Invoiced this term</p>
          <p className="mt-1 text-xl font-semibold tracking-tight" data-numeric>
            {kes(ctx.termInvoiced)}
          </p>
        </div>
        <div className="panel px-4 py-3">
          <p className="label-eyebrow">Collected</p>
          <p className="mt-1 text-xl font-semibold tracking-tight" data-numeric>
            {kes(ctx.termCollected)}
          </p>
        </div>
        <div className="panel px-4 py-3">
          <p className="label-eyebrow">Discounted</p>
          <p className="mt-1 text-xl font-semibold tracking-tight" data-numeric>
            {kes(ctx.termDiscounted)}
          </p>
        </div>
        <div className="panel px-4 py-3">
          <p className="label-eyebrow">Outstanding</p>
          <p className="mt-1 text-xl font-semibold tracking-tight text-destructive" data-numeric>
            {kes(ctx.termOutstanding)}
          </p>
        </div>
      </div>

      {ctx.invoiceRows.length === 0 && ctx.paymentRows.length === 0 ? (
        <p className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
          No invoices or payments recorded yet — reports will appear here once Finance activity begins.
        </p>
      ) : (
        <FinanceReportExports invoices={ctx.invoiceRows} payments={ctx.paymentRows} />
      )}
    </FinancePageShell>
  );
}
