import {
  KIND_LABELS,
  accountLabel,
  reconciles,
  summaryTotals,
  withRunningBalance,
  type CashbookAccountSummary,
  type CashbookEntry,
  type CashbookReconciliation,
} from "@/lib/cashbook";

const kes = (n: number) => `KES ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Read-only cashbook view. Server component: the date filter is a plain GET form. */
export function CashbookSection({
  from,
  to,
  summary,
  entries,
  reconciliation,
  truncated,
  limit,
}: {
  from: string;
  to: string;
  summary: CashbookAccountSummary[];
  entries: CashbookEntry[];
  reconciliation: CashbookReconciliation | null;
  truncated: boolean;
  limit: number;
}) {
  const totals = summaryTotals(summary);
  const rows = withRunningBalance(entries, totals.opening);
  const reconciled = reconciliation ? reconciles(reconciliation) : null;

  return (
    <div className="flex flex-col gap-4">
      <form method="get" className="panel flex flex-wrap items-end gap-3 p-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="label-eyebrow">From</span>
          <input type="date" name="from" defaultValue={from} className="rounded border bg-background px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label-eyebrow">To</span>
          <input type="date" name="to" defaultValue={to} className="rounded border bg-background px-2 py-1" />
        </label>
        <button type="submit" className="rounded border px-3 py-1 font-medium">Show</button>
        <p className="text-xs text-muted-foreground">Dates are Kenya calendar days.</p>
      </form>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="panel px-4 py-3">
          <p className="label-eyebrow">Opening balance</p>
          <p className="mt-1 text-xl font-semibold tracking-tight" data-numeric>{kes(totals.opening)}</p>
        </div>
        <div className="panel px-4 py-3">
          <p className="label-eyebrow">Money in</p>
          <p className="mt-1 text-xl font-semibold tracking-tight" data-numeric>{kes(totals.moneyIn)}</p>
        </div>
        <div className="panel px-4 py-3">
          <p className="label-eyebrow">Money out</p>
          <p className="mt-1 text-xl font-semibold tracking-tight" data-numeric>{kes(totals.moneyOut)}</p>
        </div>
        <div className="panel px-4 py-3">
          <p className="label-eyebrow">Closing balance</p>
          <p className="mt-1 text-xl font-semibold tracking-tight" data-numeric>{kes(totals.closing)}</p>
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <h3 className="px-3 pt-3 text-sm font-semibold">By account</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2 text-right">Opening</th>
              <th className="px-3 py-2 text-right">In</th>
              <th className="px-3 py-2 text-right">Out</th>
              <th className="px-3 py-2 text-right">Closing</th>
            </tr>
          </thead>
          <tbody>
            {summary.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">No money recorded yet.</td></tr>
            ) : (
              summary.map((s) => (
                <tr key={s.account} className="border-t">
                  <td className="px-3 py-2">{accountLabel(s.account)}</td>
                  <td className="px-3 py-2 text-right" data-numeric>{kes(s.opening)}</td>
                  <td className="px-3 py-2 text-right" data-numeric>{kes(s.moneyIn)}</td>
                  <td className="px-3 py-2 text-right" data-numeric>{kes(s.moneyOut)}</td>
                  <td className="px-3 py-2 text-right" data-numeric>{kes(s.closing)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="panel overflow-x-auto">
        <h3 className="px-3 pt-3 text-sm font-semibold">Entries</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">Details</th>
              <th className="px-3 py-2 text-right">In</th>
              <th className="px-3 py-2 text-right">Out</th>
              <th className="px-3 py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">No entries in this period.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={`${r.kind}-${r.sourceId}`} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap" data-numeric>{r.entryDate}</td>
                  <td className="px-3 py-2">{KIND_LABELS[r.kind]}</td>
                  <td className="px-3 py-2">{accountLabel(r.account)}</td>
                  <td className="px-3 py-2">
                    {r.description}
                    {r.reference ? <span className="text-muted-foreground"> · {r.reference}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right" data-numeric>{r.moneyIn ? kes(r.moneyIn) : ""}</td>
                  <td className="px-3 py-2 text-right" data-numeric>{r.moneyOut ? kes(r.moneyOut) : ""}</td>
                  <td className="px-3 py-2 text-right" data-numeric>{kes(r.balance)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {truncated && (
        <p className="panel border-dashed p-3 text-sm text-muted-foreground">
          This period has more than {limit.toLocaleString()} entries, so only the first {limit.toLocaleString()} are listed. The
          totals above still cover every entry. Choose a shorter period to see the rest.
        </p>
      )}

      <div className="panel p-3 text-sm">
        {reconciled === null ? (
          <p className="text-muted-foreground">Reconciliation is not available.</p>
        ) : reconciled ? (
          <p>All-time check: money received, reversals and approved expenses in this cashbook match the payment and expense records exactly.</p>
        ) : (
          <p className="font-medium">
            All-time check FAILED: the cashbook does not match the payment and expense records (receipts {kes(reconciliation!.receiptsDifference)}, reversals{" "}
            {kes(reconciliation!.reversalsDifference)}, expenses {kes(reconciliation!.expensesDifference)}). Do not rely on these totals; tell support.
          </p>
        )}
      </div>

      <div className="panel border-dashed p-3 text-xs text-muted-foreground">
        <p>How to read this: money in is every payment received (pending M-Pesa requests are not counted); money out is payment reversals and approved expenses.</p>
        <p className="mt-1">
          Expenses do not record how or when they were paid, so each approved expense is shown on its approval date under &quot;Not recorded&quot;. Approved does not always mean paid.
        </p>
      </div>
    </div>
  );
}
