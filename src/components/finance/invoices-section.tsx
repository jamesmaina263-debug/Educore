import { Badge } from "@/components/ui/badge";
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
      <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        No invoices generated yet — create a fee structure and generate invoices first.
      </p>
    );
  }

  return (
    <Table>
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
              <Badge variant={inv.status === "paid" ? "success" : inv.status === "partially_paid" ? "info" : "secondary"}>
                {inv.status.replace("_", " ")}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
