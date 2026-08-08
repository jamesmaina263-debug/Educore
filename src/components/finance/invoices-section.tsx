import { StatusBadge } from "@/components/status-badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

export interface InvoiceListRow {
  id: string;
  student_name: string;
  class_name: string;
  term_name: string;
  total_amount: number;
  status: "unpaid" | "partially_paid" | "paid";
}

export function InvoicesSection({ invoices }: { invoices: InvoiceListRow[] }) {
  if (invoices.length === 0) {
    return (
      <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
        No invoices generated yet — create a fee structure and generate invoices first.
      </div>
    );
  }

  return (
    <div className="panel overflow-x-auto">
    <Table className="table-dense">
      <TableHeader>
        <TableRow>
          <TableHead>Student</TableHead>
          <TableHead>Class</TableHead>
          <TableHead>Term</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((inv) => (
          <TableRow key={inv.id}>
            <TableCell className="font-medium">{inv.student_name}</TableCell>
            <TableCell>{inv.class_name}</TableCell>
            <TableCell>{inv.term_name}</TableCell>
            <TableCell>{inv.total_amount.toLocaleString()}</TableCell>
            <TableCell>
              <StatusBadge
                tone={inv.status === "paid" ? "success" : inv.status === "partially_paid" ? "info" : "neutral"}
                label={inv.status.replace("_", " ")}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    </div>
  );
}
