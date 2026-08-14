"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import type { InvoiceListRow } from "./invoices-section";
import type { PaymentListRow } from "./payments-section";

function toCsv(headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function FinanceReportExports({
  invoices,
  payments,
}: {
  invoices: InvoiceListRow[];
  payments: PaymentListRow[];
}) {
  return (
    <div className="panel flex flex-wrap items-center gap-3 p-4">
      <p className="text-sm font-medium">Export current data</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={invoices.length === 0}
        onClick={() =>
          download(
            "invoices.csv",
            toCsv(
              ["Student", "Class", "Created", "Total", "Paid", "Discounted", "Status"],
              invoices.map((i) => [i.student_name, i.class_name, i.created_at, i.total_amount, i.paid, i.discounted, i.status]),
            ),
          )
        }
      >
        <Download className="size-3.5" /> Invoices CSV
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={payments.length === 0}
        onClick={() =>
          download(
            "payments.csv",
            toCsv(
              ["Student", "Method", "Amount", "Reference", "Status", "Recorded"],
              payments.map((p) => [p.student_name, p.method, p.amount, p.reference ?? "", p.status, p.recorded_at]),
            ),
          )
        }
      >
        <Download className="size-3.5" /> Payments CSV
      </Button>
    </div>
  );
}
