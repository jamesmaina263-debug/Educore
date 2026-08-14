import { loadFinanceContext, kes } from "../_data";
import { FinancePageShell } from "@/components/finance/finance-page-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function FinanceReceivablesPage() {
  const ctx = await loadFinanceContext();

  const now = Date.now();
  type Row = { invoiceId: string; studentName: string; className: string; outstanding: number; ageDays: number; bucket: string };
  const rows: Row[] = [];
  for (const inv of ctx.invoiceRows) {
    const outstanding = inv.total_amount - inv.paid - inv.discounted;
    if (outstanding <= 0) continue;
    const ageDays = Math.floor((now - new Date(inv.created_at).getTime()) / 86400000);
    const bucket = ageDays <= 30 ? "0-30" : ageDays <= 60 ? "31-60" : ageDays <= 90 ? "61-90" : "90+";
    rows.push({ invoiceId: inv.id, studentName: inv.student_name, className: inv.class_name, outstanding, ageDays, bucket });
  }
  rows.sort((a, b) => b.outstanding - a.outstanding);
  const totalReceivable = rows.reduce((sum, r) => sum + r.outstanding, 0);

  return (
    <FinancePageShell ctx={ctx} section="Receivables" title="Receivables">
      <div className="panel px-4 py-3">
        <p className="label-eyebrow">Total Receivables</p>
        <p className="mt-1 text-xl font-semibold tracking-tight text-destructive" data-numeric>
          {kes(totalReceivable)}
        </p>
      </div>

      <div className="panel overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No outstanding invoices.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Bucket</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.invoiceId}>
                  <TableCell>{r.studentName}</TableCell>
                  <TableCell>{r.className}</TableCell>
                  <TableCell>{r.ageDays}d</TableCell>
                  <TableCell>{r.bucket}</TableCell>
                  <TableCell className="text-right font-medium" data-numeric>
                    {kes(r.outstanding)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </FinancePageShell>
  );
}
