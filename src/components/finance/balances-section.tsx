"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { recordPaymentAction } from "@/app/finance/actions";

export interface BalanceRow {
  student_id: string;
  full_name: string;
  class_name: string;
  total_invoiced: number;
  total_discounted: number;
  total_paid: number;
  balance: number;
}

export function BalancesSection({ rows, canWrite }: { rows: BalanceRow[]; canWrite: boolean }) {
  const router = useRouter();
  const [target, setTarget] = useState<BalanceRow | null>(null);
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

  if (rows.length === 0) {
    return (
      <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
        No invoices generated yet — balances appear once invoices exist.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="panel overflow-x-auto">
        <Table className="table-dense">
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            <TableHead>Class</TableHead>
            <TableHead>Invoiced</TableHead>
            <TableHead>Discounted</TableHead>
            <TableHead>Paid</TableHead>
            <TableHead>Balance</TableHead>
            {canWrite && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.student_id}>
              <TableCell className="font-medium">{r.full_name}</TableCell>
              <TableCell>{r.class_name}</TableCell>
              <TableCell data-numeric>{r.total_invoiced.toLocaleString()}</TableCell>
              <TableCell data-numeric>{r.total_discounted.toLocaleString()}</TableCell>
              <TableCell data-numeric>{r.total_paid.toLocaleString()}</TableCell>
              <TableCell className={r.balance > 0 ? "font-medium text-danger" : "text-success"} data-numeric>
                {r.balance.toLocaleString()}
              </TableCell>
              {canWrite && (
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setTarget(r)}>
                    Record payment
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payment — {target?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Outstanding balance: KES {target?.balance.toLocaleString()}. Applies to the oldest outstanding invoice first.
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
    </div>
  );
}
