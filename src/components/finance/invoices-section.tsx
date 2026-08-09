"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { recordPaymentAction } from "@/app/finance/actions";

export interface InvoiceListRow {
  id: string;
  student_id: string;
  student_name: string;
  class_name: string;
  created_at: string;
  total_amount: number;
  paid: number;
  discounted: number;
  status: "unpaid" | "partially_paid" | "paid";
}

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const invoiceRef = (id: string) => `INV-${id.slice(0, 8).toUpperCase()}`;

function invoiceTone(status: InvoiceListRow["status"]) {
  return status === "paid" ? "success" : status === "partially_paid" ? "warning" : "neutral";
}

export function InvoicesSection({ invoices, canWrite }: { invoices: InvoiceListRow[]; canWrite: boolean }) {
  const router = useRouter();
  const [target, setTarget] = useState<InvoiceListRow | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"mpesa" | "cash" | "bank" | "cheque">("mpesa");
  const [reference, setReference] = useState("");
  const [phone, setPhone] = useState("");

  async function handleRecord() {
    if (!target) return;
    setPending(true);
    setError(null);
    const result = await recordPaymentAction({
      student_id: target.student_id,
      method,
      amount: Number(amount),
      reference: reference || undefined,
      phone_number: phone || undefined,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setTarget(null);
    setAmount("");
    setReference("");
    setPhone("");
    router.refresh();
  }

  if (invoices.length === 0) {
    return (
      <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
        No invoices generated yet — create a fee structure and generate invoices first.
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Invoice register</h2>
          <span className="text-[0.6875rem] text-muted-foreground">
            {invoices.length} invoice{invoices.length === 1 ? "" : "s"}
          </span>
        </header>
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead className="bg-muted/70">
              <tr>
                <th>Reference</th>
                <th>Student</th>
                <th>Class</th>
                <th>Issued</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Paid</th>
                <th className="text-right">Balance</th>
                <th>Status</th>
                {canWrite && (
                  <th className="w-10 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const balance = inv.total_amount - inv.paid - inv.discounted;
                return (
                  <tr key={inv.id}>
                    <td className="font-mono text-[0.75rem] text-muted-foreground">{invoiceRef(inv.id)}</td>
                    <td className="font-medium">{inv.student_name}</td>
                    <td className="text-muted-foreground">{inv.class_name}</td>
                    <td className="text-muted-foreground">{new Date(inv.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</td>
                    <td className="text-right" data-numeric>
                      {kes(inv.total_amount)}
                    </td>
                    <td className="text-right" data-numeric>
                      {kes(inv.paid)}
                    </td>
                    <td className={balance > 0 ? "text-right font-medium text-destructive" : "text-right"} data-numeric>
                      {balance > 0 ? kes(balance) : "—"}
                    </td>
                    <td>
                      <StatusBadge tone={invoiceTone(inv.status)} label={inv.status.replace("_", " ")} />
                    </td>
                    {canWrite && (
                      <td className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              aria-label={`Actions for ${invoiceRef(inv.id)}`}
                              className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            >
                              <MoreHorizontal className="size-4" aria-hidden />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem disabled={balance <= 0} onSelect={() => setTarget(inv)}>
                              Record payment
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payment — {target?.student_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Applies to {target?.student_name}&apos;s oldest outstanding invoice first, not only {target ? invoiceRef(target.id) : ""}.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mpesa">M-Pesa</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="bank">Bank</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {method === "mpesa" ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>M-Pesa reference (from confirmation SMS)</Label>
                  <Input placeholder="QWE123XYZ" value={reference} onChange={(e) => setReference(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone number</Label>
                  <Input placeholder="2547XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Reference</Label>
                <Input placeholder="Cheque / transaction number" value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
          <DialogFooter>
            <Button onClick={handleRecord} disabled={pending || !amount || Number(amount) <= 0}>
              {pending ? "Recording…" : "Record payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
