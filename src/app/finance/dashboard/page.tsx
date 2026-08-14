import { loadFinanceContext, kes } from "../_data";
import { FinancePageShell } from "@/components/finance/finance-page-shell";

export default async function FinanceDashboardPage() {
  const ctx = await loadFinanceContext();

  const recentPayments = ctx.paymentRows.slice(0, 6);
  const topOutstanding = [...ctx.balanceRows]
    .filter((b) => b.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 6);

  const now = Date.now();
  const buckets = { d30: 0, d60: 0, d90: 0, d90plus: 0 };
  for (const inv of ctx.invoiceRows) {
    const outstanding = inv.total_amount - inv.paid - inv.discounted;
    if (outstanding <= 0) continue;
    const ageDays = Math.floor((now - new Date(inv.created_at).getTime()) / 86400000);
    if (ageDays <= 30) buckets.d30 += outstanding;
    else if (ageDays <= 60) buckets.d60 += outstanding;
    else if (ageDays <= 90) buckets.d90 += outstanding;
    else buckets.d90plus += outstanding;
  }
  const totalOutstandingAging = buckets.d30 + buckets.d60 + buckets.d90 + buckets.d90plus;

  return (
    <FinancePageShell ctx={ctx} section="Dashboard" title="Finance Dashboard">
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

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="panel p-4">
          <p className="mb-3 text-sm font-semibold">Recent Financial Activities</p>
          {recentPayments.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No recent activities. Financial transactions and activities will appear here.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {recentPayments.map((p) => (
                <li key={p.id} className="flex items-center justify-between border-b border-border/60 pb-2 last:border-0">
                  <span>{p.student_name || "Unknown student"}</span>
                  <span className="font-medium" data-numeric>
                    {kes(p.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel p-4">
          <p className="mb-3 text-sm font-semibold">Outstanding by Age</p>
          {totalOutstandingAging === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No outstanding balances.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              <li className="flex items-center justify-between">
                <span>0 - 30 Days</span>
                <span data-numeric>{kes(buckets.d30)}</span>
              </li>
              <li className="flex items-center justify-between">
                <span>31 - 60 Days</span>
                <span data-numeric>{kes(buckets.d60)}</span>
              </li>
              <li className="flex items-center justify-between">
                <span>61 - 90 Days</span>
                <span data-numeric>{kes(buckets.d90)}</span>
              </li>
              <li className="flex items-center justify-between">
                <span>90+ Days</span>
                <span data-numeric>{kes(buckets.d90plus)}</span>
              </li>
              <li className="flex items-center justify-between border-t border-border pt-2 font-semibold text-destructive">
                <span>Total Outstanding</span>
                <span data-numeric>{kes(totalOutstandingAging)}</span>
              </li>
            </ul>
          )}
        </div>
      </div>

      <div className="panel p-4">
        <p className="mb-3 text-sm font-semibold">Top Outstanding Students</p>
        {topOutstanding.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No outstanding accounts. Student outstanding accounts will appear here.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {topOutstanding.map((b) => (
              <li key={b.student_id} className="flex items-center justify-between border-b border-border/60 pb-2 last:border-0">
                <span>
                  {b.full_name} <span className="text-muted-foreground">· {b.class_name}</span>
                </span>
                <span className="font-medium text-destructive" data-numeric>
                  {kes(b.balance)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </FinancePageShell>
  );
}
