"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { reversePaymentAction } from "@/app/(app)/finance/actions";

export interface PaymentListRow {
  id: string;
  student_name: string;
  method: "mpesa" | "cash" | "bank" | "cheque" | "card" | "other";
  amount: number;
  reference: string | null;
  purpose: string | null;
  status: "pending" | "recorded" | "confirmed" | "reversed" | "unallocated";
  receipt_number: string | null;
  reversed_total: number;
  recorded_at: string;
}

const statusVariant: Record<PaymentListRow["status"], "default" | "outline" | "secondary" | "destructive"> = {
  pending: "secondary",
  recorded: "secondary",
  confirmed: "default",
  reversed: "destructive",
  unallocated: "outline",
};

export function PaymentsSection({ payments, canReverse }: { payments: PaymentListRow[]; canReverse: boolean }) {
  const router = useRouter();
  const [target, setTarget] = useState<PaymentListRow | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReverse() {
    if (!target) return;
    setPending(true);
    setError(null);
    const result = await reversePaymentAction({ payment_id: target.id, amount: Number(amount), reason });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setTarget(null);
    setAmount("");
    setReason("");
    router.refresh();
  }

  if (payments.length === 0) {
    return (
      <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
        No payments recorded yet.
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
          <TableHead>Method</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Reference</TableHead>
          <TableHead>Purpose</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Receipt</TableHead>
          <TableHead>Recorded</TableHead>
          {canReverse && <TableHead className="text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {payments.map((p) => {
          const remaining = p.amount - p.reversed_total;
          const canReverseThis = canReverse && p.status !== "unallocated" && p.status !== "reversed" && remaining > 0;
          return (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.student_name || "— unallocated —"}</TableCell>
              <TableCell>
                <Badge variant="outline">{p.method}</Badge>
              </TableCell>
              <TableCell data-numeric>
                {p.amount.toLocaleString()}
                {p.reversed_total > 0 && (
                  <span className="block text-xs text-muted-foreground">−{p.reversed_total.toLocaleString()} reversed</span>
                )}
              </TableCell>
              <TableCell>{p.reference ?? "—"}</TableCell>
              <TableCell>{p.purpose ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={statusVariant[p.status]}>{p.status}</Badge>
              </TableCell>
              <TableCell className="font-mono text-xs">{p.receipt_number ?? "—"}</TableCell>
              <TableCell>{new Date(p.recorded_at).toLocaleDateString()}</TableCell>
              {canReverse && (
                <TableCell className="text-right">
                  {canReverseThis && (
                    <Button size="sm" variant="outline" onClick={() => { setTarget(p); setAmount(String(remaining)); }}>
                      Reverse
                    </Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
    </div>

    <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reverse payment — {target?.student_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This records an offsetting reversal — the original payment stays on record. Any portion that had been
            applied to an invoice is pulled back; any portion that was sitting as credit is removed from the account.
          </p>
          <div className="space-y-1.5">
            <Label>Amount to reverse</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Cheque bounced, entered against wrong student, duplicate entry" />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="destructive" onClick={handleReverse} disabled={pending || !amount || Number(amount) <= 0 || !reason.trim()}>
            {pending ? "Reversing…" : "Reverse payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </div>
  );
}
