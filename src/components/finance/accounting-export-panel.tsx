"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { downloadBlob } from "@/lib/xlsx-export";
import { buildCsv, CSV_MIME } from "@/lib/csv-export";
import {
  buildJournalLines,
  exportFilename,
  toQuickBooksRows,
  toSageRows,
  unbalancedJournals,
  validateExportOptions,
  type AccountingFormat,
} from "@/lib/accounting-export";
import type { LedgerLine } from "@/lib/vote-heads";

function nairobiToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());
}

/**
 * Finance > Vote heads: download the ledger as a journal CSV for QuickBooks Online or Sage 50.
 * File-based and read-only: nothing is written to EduCore and nothing is sent anywhere. Blocked while the
 * ledger does not reconcile with the invoices and approved expenses it is built from.
 */
export function AccountingExportPanel({
  ledger,
  periodLabel,
  reconciled,
}: {
  ledger: LedgerLine[];
  periodLabel: string;
  reconciled: boolean;
}) {
  const [date, setDate] = useState(nairobiToday);
  const [receivable, setReceivable] = useState("Accounts Receivable");
  const [payable, setPayable] = useState("Accounts Payable");
  const [accountNames, setAccountNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<AccountingFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mappedHeads = useMemo(() => ledger.filter((l) => l.voteHeadId && l.amount !== 0), [ledger]);
  const hasUnmapped = ledger.some((l) => !l.voteHeadId && l.amount !== 0);
  const hasData = ledger.some((l) => l.amount !== 0);

  async function run(format: AccountingFormat) {
    setError(null);
    const cleaned: Record<string, string> = {};
    for (const [code, name] of Object.entries(accountNames)) if (name.trim()) cleaned[code] = name;
    const opts = { date, periodLabel, receivableAccount: receivable, payableAccount: payable, accountNames: cleaned };
    const problem = validateExportOptions(opts);
    if (problem) return setError(problem);
    const lines = buildJournalLines(ledger, opts);
    if (lines.length === 0) return setError("There is nothing to export for this period.");
    if (unbalancedJournals(lines).length > 0) return setError("The journal does not balance, so it was not exported. Please report this.");
    setBusy(format);
    try {
      const csv = await buildCsv(format === "quickbooks" ? toQuickBooksRows(lines) : toSageRows(lines));
      downloadBlob(csv, exportFilename(format, date), CSV_MIME);
    } catch {
      setError("Could not build the file. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold">Export for accounting software</h2>
        <p className="text-sm text-muted-foreground">
          Downloads {periodLabel} as a journal file: fees invoiced (credit each income vote head, debit receivables) and approved spending (debit each
          expense vote head, credit payables). Payments are not included. Nothing is sent anywhere; import the file yourself and check it against your
          chart of accounts first.
        </p>
      </div>

      {!reconciled && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
          The ledger does not reconcile with invoices and approved expenses (see the control totals above), so export is switched off until it does.
        </p>
      )}
      {reconciled && hasUnmapped && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
          Some income or spending is unmapped or not itemised. It will be exported under its own &quot;Unmapped&quot; / &quot;Invoiced but not itemised&quot; account so
          the books still balance; map those items to vote heads first for a cleaner import.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="acct-date">Journal date</Label>
          <Input id="acct-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="acct-recv">Receivable account name</Label>
          <Input id="acct-recv" value={receivable} maxLength={100} onChange={(e) => setReceivable(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="acct-pay">Payable account name</Label>
          <Input id="acct-pay" value={payable} maxLength={100} onChange={(e) => setPayable(e.target.value)} />
        </div>
      </div>

      {mappedHeads.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Account names for each vote head (optional)</summary>
          <p className="mb-2 mt-1 text-muted-foreground">
            Leave blank to use &quot;CODE - Name&quot;. Fill in the exact account name or code from your accounting software to avoid renaming after import.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {mappedHeads.map((h) => (
              <div key={h.code} className="flex flex-col gap-1">
                <Label htmlFor={`acct-${h.code}`}>
                  {h.code} <span className="text-muted-foreground">({h.kind})</span>
                </Label>
                <Input
                  id={`acct-${h.code}`}
                  value={accountNames[h.code] ?? ""}
                  maxLength={100}
                  placeholder={`${h.code} - ${h.name}`}
                  onChange={(e) => setAccountNames((prev) => ({ ...prev, [h.code]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={!reconciled || !hasData || busy !== null} onClick={() => run("quickbooks")}>
          {busy === "quickbooks" ? "Preparing…" : "Download for QuickBooks (CSV)"}
        </Button>
        <Button type="button" variant="outline" disabled={!reconciled || !hasData || busy !== null} onClick={() => run("sage")}>
          {busy === "sage" ? "Preparing…" : "Download for Sage (CSV)"}
        </Button>
        {!hasData && <span className="text-sm text-muted-foreground">No income or spending in this period.</span>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
