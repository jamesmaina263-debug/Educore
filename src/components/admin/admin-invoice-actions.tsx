"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PAYMENT_METHOD_LABEL, formatKes } from "@/lib/billing/format";
import {
  adjustInvoiceAction,
  cancelInvoiceAction,
  issueInvoiceAction,
  markInvoiceSentAction,
  recalculateInvoiceAction,
  recordInvoicePaymentAction,
  regeneratePdfAction,
  reissueInvoiceAction,
  saveSchoolBillingTermsAction,
  sendInvoiceAction,
  setDueDateAction,
  setInvoiceNotesAction,
  voidPaymentAction,
} from "@/app/(admin)/admin/billing/invoices/actions";

type Mode = "payment" | "adjust" | "due" | "cancel" | "reissue" | "send" | "notes" | "manualSent" | null;

export type InvoiceActionsProps = {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  amount: number;
  amountPaid: number;
  balance: number;
  discount: number;
  subtotal: number;
  dueOn: string; // YYYY-MM-DD (Nairobi)
  notes: string | null;
  sentAt: string | null;
  suggestedEmail: string | null;
  todayISO: string;
};

export function AdminInvoiceActions(p: InvoiceActionsProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // form state (one set, reset when a dialog opens)
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(p.todayISO);
  const [method, setMethod] = useState("mpesa");
  const [reference, setReference] = useState("");
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [to, setTo] = useState("");

  const isDraft = p.status === "draft";
  const isOpen = ["issued", "sent", "overdue", "partially_paid"].includes(p.status);
  const canPay = isOpen && p.balance > 0;
  const hasPayments = p.amountPaid > 0;

  function open(m: Exclude<Mode, null>) {
    setError(null);
    setReason("");
    setAmount(m === "payment" ? String(p.balance) : m === "adjust" ? String(p.discount) : "");
    setPaidOn(p.todayISO);
    setText(m === "due" ? p.dueOn : m === "notes" ? (p.notes ?? "") : "");
    setTo(p.suggestedEmail ?? "");
    setMode(m);
  }

  function run(fn: () => Promise<{ error: string } | { success: true }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if ("error" in res) return setError(res.error);
      setMode(null);
      after?.();
      router.refresh();
    });
  }

  function quick(fn: () => Promise<{ error: string } | { success: true }>, ok: string) {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if ("error" in res) setError(res.error);
      else {
        setNotice(ok);
        router.refresh();
      }
    });
  }

  const reasonOk = reason.trim().length >= 3;

  return (
    <div className="panel">
      <header className="border-b border-border px-4 py-2.5">
        <h2 className="text-[0.8125rem] font-semibold">Actions</h2>
      </header>
      <div className="flex flex-col gap-2 p-4">
        {isDraft && (
          <>
            <Button disabled={pending} onClick={() => quick(() => issueInvoiceAction(p.invoiceId), "Invoice issued. The school can now see it.")}>
              Issue invoice
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => quick(() => recalculateInvoiceAction(p.invoiceId), "Recalculated from current student count and rate.")}>
              Recalculate
            </Button>
          </>
        )}
        {isOpen && (
          <Button onClick={() => open("send")} disabled={pending}>
            {p.sentAt ? "Resend by email" : "Send by email"}
          </Button>
        )}
        {canPay && (
          <Button variant="outline" onClick={() => open("payment")} disabled={pending}>
            Record payment
          </Button>
        )}
        {(isDraft || isOpen) && (
          <Button variant="outline" onClick={() => open("adjust")} disabled={pending}>
            Add discount / adjustment
          </Button>
        )}
        {isOpen && (
          <Button variant="outline" onClick={() => open("due")} disabled={pending}>
            Change due date
          </Button>
        )}
        {p.status !== "cancelled" && (
          <Button variant="outline" onClick={() => open("notes")} disabled={pending}>
            Edit invoice notes
          </Button>
        )}
        {p.status !== "cancelled" && p.status !== "draft" && (
          <Button variant="outline" disabled={pending} onClick={() => quick(() => regeneratePdfAction(p.invoiceId), "PDF regenerated with the current payment instructions.")}>
            Regenerate PDF
          </Button>
        )}
        {isOpen && !p.sentAt && (
          <Button variant="ghost" onClick={() => open("manualSent")} disabled={pending}>
            Mark as sent (delivered outside the system)
          </Button>
        )}
        {isOpen && !hasPayments && (
          <Button variant="outline" onClick={() => open("reissue")} disabled={pending}>
            Reissue (new number)
          </Button>
        )}
        {(isDraft || (isOpen && !hasPayments)) && (
          <Button variant="outline" className="text-danger" onClick={() => open("cancel")} disabled={pending}>
            {isDraft ? "Discard draft" : "Cancel invoice"}
          </Button>
        )}
        {!isDraft && !isOpen && <p className="text-sm text-muted-foreground">No further actions for a {p.status} invoice.</p>}
        {notice && (
          <p role="status" className="text-sm text-success">
            {notice}
          </p>
        )}
        {error && !mode && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      <Dialog open={mode !== null} onOpenChange={(o) => !o && !pending && setMode(null)}>
        <DialogContent>
          {mode === "payment" && (
            <>
              <DialogHeader>
                <DialogTitle>Record payment</DialogTitle>
                <DialogDescription>
                  {p.invoiceNumber} · outstanding {formatKes(p.balance)}. Enter part of the balance for a partial payment.
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pay-amt">Amount (KES)</Label>
                  <Input id="pay-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pay-date">Date received</Label>
                  <Input id="pay-date" type="date" value={paidOn} max={p.todayISO} onChange={(e) => setPaidOn(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pay-method">Method</Label>
                  <select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
                    {Object.entries(PAYMENT_METHOD_LABEL)
                      .filter(([k]) => k !== "unspecified")
                      .map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pay-ref">Reference</Label>
                  <Input id="pay-ref" placeholder="e.g. M-Pesa code" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} />
                </div>
              </div>
              <Footer
                error={error}
                pending={pending}
                label="Record payment"
                disabled={!(Number(amount) > 0)}
                onCancel={() => setMode(null)}
                onConfirm={() =>
                  run(() => recordInvoicePaymentAction(p.invoiceId, { amount: Number(amount), paidOn, method, reference, notes: "" }), () => setReference(""))
                }
              />
            </>
          )}

          {mode === "adjust" && (
            <>
              <DialogHeader>
                <DialogTitle>Discount / adjustment</DialogTitle>
                <DialogDescription>
                  Sets the total discount in KES on {p.invoiceNumber} (subtotal {formatKes(p.subtotal)}). Tax is recalculated. Recorded in the audit trail.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="adj-amt">Total discount (KES)</Label>
                  <Input id="adj-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <ReasonField value={reason} onChange={setReason} />
              </div>
              <Footer error={error} pending={pending} label="Apply" disabled={!reasonOk || !(Number(amount) >= 0)} onCancel={() => setMode(null)} onConfirm={() => run(() => adjustInvoiceAction(p.invoiceId, Number(amount), reason))} />
            </>
          )}

          {mode === "due" && (
            <>
              <DialogHeader>
                <DialogTitle>Change due date</DialogTitle>
                <DialogDescription>Moving the date forward on an overdue invoice puts it back to open.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="due-date">New due date</Label>
                  <Input id="due-date" type="date" value={text} onChange={(e) => setText(e.target.value)} />
                </div>
                <ReasonField value={reason} onChange={setReason} />
              </div>
              <Footer error={error} pending={pending} label="Change due date" disabled={!reasonOk || !text} onCancel={() => setMode(null)} onConfirm={() => run(() => setDueDateAction(p.invoiceId, text, reason))} />
            </>
          )}

          {mode === "notes" && (
            <>
              <DialogHeader>
                <DialogTitle>Invoice notes</DialogTitle>
                <DialogDescription>Printed on the invoice and visible to the school. Do not put internal comments here.</DialogDescription>
              </DialogHeader>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={5} />
              <Footer error={error} pending={pending} label="Save notes" onCancel={() => setMode(null)} onConfirm={() => run(() => setInvoiceNotesAction(p.invoiceId, text))} />
            </>
          )}

          {mode === "cancel" && (
            <>
              <DialogHeader>
                <DialogTitle>{isDraft ? "Discard draft" : "Cancel invoice"} {p.invoiceNumber}</DialogTitle>
                <DialogDescription>
                  The number is kept (never reused) and the invoice stays in the history as cancelled. This does not reactivate a suspended school.
                </DialogDescription>
              </DialogHeader>
              <ReasonField value={reason} onChange={setReason} />
              <Footer error={error} pending={pending} destructive label="Cancel invoice" disabled={!reasonOk} onCancel={() => setMode(null)} onConfirm={() => run(() => cancelInvoiceAction(p.invoiceId, reason))} />
            </>
          )}

          {mode === "reissue" && (
            <>
              <DialogHeader>
                <DialogTitle>Reissue {p.invoiceNumber}</DialogTitle>
                <DialogDescription>
                  Cancels this invoice and issues a new one (new number) for the same period, recalculated from the current student count, rate and payment instructions. Both stay linked in the history.
                </DialogDescription>
              </DialogHeader>
              <ReasonField value={reason} onChange={setReason} />
              <Footer
                error={error}
                pending={pending}
                label="Reissue"
                disabled={!reasonOk}
                onCancel={() => setMode(null)}
                onConfirm={() => {
                  setError(null);
                  startTransition(async () => {
                    const res = await reissueInvoiceAction(p.invoiceId, reason);
                    if ("error" in res) return setError(res.error);
                    setMode(null);
                    router.push(`/admin/billing/invoices/${res.id}`);
                  });
                }}
              />
            </>
          )}

          {mode === "send" && (
            <>
              <DialogHeader>
                <DialogTitle>{p.sentAt ? "Resend" : "Send"} {p.invoiceNumber}</DialogTitle>
                <DialogDescription>
                  Emails the PDF with subject “EduCore Invoice {p.invoiceNumber} — [school]”. Leave the address blank to use the school&apos;s billing email, then the school owner.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="send-to">Send to (optional)</Label>
                <Input id="send-to" type="email" placeholder={p.suggestedEmail ?? "billing@school.example"} value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
              <Footer
                error={error}
                pending={pending}
                label={p.sentAt ? "Resend email" : "Send email"}
                onCancel={() => setMode(null)}
                onConfirm={() => {
                  setError(null);
                  startTransition(async () => {
                    const res = await sendInvoiceAction(p.invoiceId, { to, resend: !!p.sentAt });
                    if ("error" in res) return setError(res.error);
                    setMode(null);
                    setNotice(`Sent to ${res.sentTo}.${res.warning ? ` ${res.warning}` : ""}`);
                    router.refresh();
                  });
                }}
              />
            </>
          )}

          {mode === "manualSent" && (
            <>
              <DialogHeader>
                <DialogTitle>Mark as sent</DialogTitle>
                <DialogDescription>Use this if you delivered the PDF yourself (e.g. WhatsApp or in person). Nothing is emailed.</DialogDescription>
              </DialogHeader>
              <Input placeholder="How was it delivered? e.g. WhatsApp to the bursar" value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} maxLength={200} />
              <Footer error={error} pending={pending} label="Mark as sent" onCancel={() => setMode(null)} onConfirm={() => run(() => markInvoiceSentAction(p.invoiceId, deliveryNote))} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="reason">Reason (required, kept in the audit trail)</Label>
      <Textarea id="reason" rows={3} value={value} onChange={(e) => onChange(e.target.value)} maxLength={300} />
    </div>
  );
}

function Footer(props: {
  error: string | null;
  pending: boolean;
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      {props.error && (
        <p role="alert" className="text-sm text-danger">
          {props.error}
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={props.onCancel} disabled={props.pending}>
          Back
        </Button>
        <Button variant={props.destructive ? "destructive" : "default"} onClick={props.onConfirm} disabled={props.pending || props.disabled}>
          {props.pending ? "Working…" : props.label}
        </Button>
      </DialogFooter>
    </>
  );
}

export function AdminVoidPaymentButton({ invoiceId, paymentId, amount }: { invoiceId: string; paymentId: string; amount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button size="sm" variant="ghost" className="text-danger" onClick={() => setOpen(true)}>
        Void
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void payment of {formatKes(amount)}</DialogTitle>
            <DialogDescription>Use this for a payment entered by mistake. It is kept in the history, marked voided, and the invoice balance is restored.</DialogDescription>
          </DialogHeader>
          <ReasonField value={reason} onChange={setReason} />
          <Footer
            error={error}
            pending={pending}
            destructive
            label="Void payment"
            disabled={reason.trim().length < 3}
            onCancel={() => setOpen(false)}
            onConfirm={() => {
              setError(null);
              startTransition(async () => {
                const res = await voidPaymentAction(invoiceId, paymentId, reason);
                if ("error" in res) return setError(res.error);
                setOpen(false);
                router.refresh();
              });
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AdminBillingTermsForm(props: {
  schoolId: string;
  invoiceId: string;
  planPrice: number | null;
  priceOverride: number | null;
  discountPercent: number;
  discountNote: string | null;
  billingEmail: string | null;
}) {
  const router = useRouter();
  const [price, setPrice] = useState(props.priceOverride == null ? "" : String(props.priceOverride));
  const [disc, setDisc] = useState(String(props.discountPercent || ""));
  const [note, setNote] = useState(props.discountNote ?? "");
  const [email, setEmail] = useState(props.billingEmail ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="panel">
      <header className="border-b border-border px-4 py-2.5">
        <h2 className="text-[0.8125rem] font-semibold">School billing terms</h2>
        <p className="text-xs text-muted-foreground">Apply to future invoices only. Existing invoices keep what was recorded on them.</p>
      </header>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bt-price">Custom price per student (KES)</Label>
          <Input id="bt-price" inputMode="decimal" placeholder={props.planPrice == null ? "Plan price" : `Plan price: ${props.planPrice}`} value={price} onChange={(e) => setPrice(e.target.value)} />
          <p className="text-xs text-muted-foreground">Leave blank to use the plan price.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bt-disc">Recurring discount (%)</Label>
            <Input id="bt-disc" inputMode="decimal" value={disc} onChange={(e) => setDisc(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bt-note">Discount note</Label>
            <Input id="bt-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bt-email">Billing email</Label>
          <Input id="bt-email" type="email" placeholder="Falls back to the school owner" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {saved && <p className="text-sm text-success">Saved.</p>}
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            setError(null);
            setSaved(false);
            startTransition(async () => {
              const res = await saveSchoolBillingTermsAction(props.schoolId, props.invoiceId, { priceOverride: price, discountPercent: disc, discountNote: note, billingEmail: email });
              if ("error" in res) return setError(res.error);
              setSaved(true);
              router.refresh();
            });
          }}
        >
          {pending ? "Saving…" : "Save billing terms"}
        </Button>
      </div>
    </div>
  );
}
