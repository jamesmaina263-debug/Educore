import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

export interface PaymentListRow {
  id: string;
  student_name: string;
  method: "mpesa" | "cash" | "bank" | "cheque";
  amount: number;
  reference: string | null;
  recorded_at: string;
}

export function PaymentsSection({ payments }: { payments: PaymentListRow[] }) {
  if (payments.length === 0) {
    return (
      <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
        No payments recorded yet.
      </div>
    );
  }

  return (
    <div className="panel overflow-x-auto">
    <Table className="table-dense">
      <TableHeader>
        <TableRow>
          <TableHead>Student</TableHead>
          <TableHead>Method</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Reference</TableHead>
          <TableHead>Recorded</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {payments.map((p) => (
          <TableRow key={p.id}>
            <TableCell className="font-medium">{p.student_name}</TableCell>
            <TableCell>
              <Badge variant="outline">{p.method}</Badge>
            </TableCell>
            <TableCell>{p.amount.toLocaleString()}</TableCell>
            <TableCell>{p.reference ?? "—"}</TableCell>
            <TableCell>{new Date(p.recorded_at).toLocaleDateString()}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    </div>
  );
}
