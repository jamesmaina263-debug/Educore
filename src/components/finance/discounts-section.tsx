"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { requestDiscountAction, approveDiscountAction, rejectDiscountAction } from "@/app/finance/actions";

export interface DiscountRow {
  id: string;
  student_name: string;
  invoice_id: string;
  amount: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
}

export interface InvoiceOption {
  id: string;
  student_id: string;
  student_name: string;
  total_amount: number;
}

export function DiscountsSection({
  discounts,
  invoiceOptions,
  canRequest,
  canApprove,
}: {
  discounts: DiscountRow[];
  invoiceOptions: InvoiceOption[];
  canRequest: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const uniqueStudents = Array.from(new Map(invoiceOptions.map((i) => [i.student_id, i.student_name])).entries());

  async function handleRequest() {
    const invoice = invoiceOptions.find((i) => i.id === invoiceId);
    if (!invoice) return;
    setPending(true);
    setError(null);
    const result = await requestDiscountAction({ student_id: invoice.student_id, invoice_id: invoiceId, amount: Number(amount), reason });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setInvoiceId("");
    setAmount("");
    setReason("");
    router.refresh();
  }

  async function handleApprove(id: string) {
    setPending(true);
    const result = await approveDiscountAction(id);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function handleReject(id: string) {
    setPending(true);
    const result = await rejectDiscountAction(id);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      {canRequest && (
        <div className="flex justify-end">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                Request discount
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Request a discount</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Invoice</Label>
                  <Select value={invoiceId} onValueChange={setInvoiceId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select an invoice" />
                    </SelectTrigger>
                    <SelectContent>
                      {invoiceOptions.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.student_name} — KES {i.total_amount.toLocaleString()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Discount amount</Label>
                  <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Reason</Label>
                  <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
                </div>
                {error && <p className="text-sm text-danger">{error}</p>}
              </div>
              <DialogFooter>
                <Button onClick={handleRequest} disabled={pending || !invoiceId || !amount || !reason.trim()}>
                  {pending ? "Submitting…" : "Submit for approval"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
      {uniqueStudents.length === 0 && canRequest && (
        <p className="text-sm text-muted-foreground">No invoices exist yet to discount.</p>
      )}

      {discounts.length === 0 ? (
        <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
          No discount requests yet.
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <Table className="table-dense">
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              {canApprove && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {discounts.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.student_name}</TableCell>
                <TableCell>{d.amount.toLocaleString()}</TableCell>
                <TableCell>{d.reason}</TableCell>
                <TableCell>
                  <StatusBadge
                    tone={d.status === "approved" ? "success" : d.status === "rejected" ? "danger" : "neutral"}
                    label={d.status}
                  />
                </TableCell>
                {canApprove && (
                  <TableCell className="text-right">
                    {d.status === "pending" && (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" disabled={pending} onClick={() => handleApprove(d.id)}>
                          Approve
                        </Button>
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleReject(d.id)}>
                          Reject
                        </Button>
                      </div>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      )}
    </div>
  );
}
