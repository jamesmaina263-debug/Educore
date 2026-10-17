"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatKes } from "@/lib/billing/format";
import { deleteInvoicePermanentlyAction } from "@/app/(admin)/admin/billing/invoices/actions";

type Props = {
  invoiceId: string;
  invoiceNumber: string;
  schoolName: string;
  status: string;
  amountPaid: number;
  paymentCount: number;
  sentAt: string | null;
};

/**
 * Platform-admin only (the page is already gated, and the SQL function re-checks). Permanently removes
 * an invoice, its payments and its history. Meant for trial/test invoices a school should never have
 * seen; real invoices should be cancelled, which keeps the record.
 */
export function AdminDeleteInvoicePanel(p: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirmed = typed.trim() === p.invoiceNumber && reason.trim().length >= 3;
  const hasMoney = p.paymentCount > 0 || p.amountPaid > 0;

  function close() {
    if (pending) return;
    setOpen(false);
    setTyped("");
    setReason("");
    setError(null);
  }

  return (
    <div className="panel border-danger/30">
      <header className="border-b border-border px-4 py-2.5">
        <h2 className="text-[0.8125rem] font-semibold text-danger">Danger zone</h2>
        <p className="text-xs text-muted-foreground">For trial or mistaken invoices only. Real invoices should be cancelled so the record is kept.</p>
      </header>
      <div className="p-4">
        <Button variant="outline" className="border-danger/40 text-danger" onClick={() => setOpen(true)}>
          Delete permanently…
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permanently delete {p.invoiceNumber}</DialogTitle>
            <DialogDescription>
              This removes the invoice for {p.schoolName} from the platform and from the school&apos;s billing page. It cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>The invoice, its PDF record and its full history are erased.</li>
            {hasMoney && (
              <li className="font-medium text-danger">
                {p.paymentCount} recorded payment{p.paymentCount === 1 ? "" : "s"} ({formatKes(p.amountPaid)} received) will be erased too. Only do this if that money was never real.
              </li>
            )}
            {p.sentAt && <li>This invoice was already sent to the school, so its number will stay retired (a gap in the sequence).</li>}
            <li>A note of what was deleted, and why, is kept in the admin activity log.</li>
          </ul>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="del-reason">Reason</Label>
            <Textarea id="del-reason" rows={2} placeholder="e.g. Trial invoice created while testing" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="del-confirm">
              Type <span className="font-mono font-semibold">{p.invoiceNumber}</span> to confirm
            </Label>
            <Input id="del-confirm" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={pending}>
              Back
            </Button>
            <Button
              variant="destructive"
              disabled={pending || !confirmed}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const res = await deleteInvoicePermanentlyAction(p.invoiceId, typed, reason);
                  if ("error" in res) return setError(res.error);
                  router.push("/admin/billing/invoices");
                  router.refresh();
                });
              }}
            >
              {pending ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
