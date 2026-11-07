"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cancelRefundRequestAction,
  createRefundRequestAction,
  decideRefundRequestAction,
  recordRefundPayoutAction,
} from "@/app/(app)/finance/refunds/actions";
import {
  METHOD_OPTIONS,
  REASON_OPTIONS,
  canCancel,
  canDecide,
  canRecordPayout,
  methodLabel,
  reasonLabel,
  statusLabel,
  summarise,
  validatePayoutForm,
  validateRequestForm,
  type PayoutMethod,
  type RefundReason,
} from "@/lib/refunds";

export interface RefundRow {
  id: string;
  amount: number;
  status: string;
  reasonCode: string;
  reasonNote: string | null;
  requestedAt: string;
  requestedBy: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  studentName: string;
  admissionNumber: string | null;
  paymentLabel: string;
  payout: { method: string; reference: string; paidAt: string; paidBy: string | null } | null;
}

export interface RefundCandidate {
  studentId: string;
  name: string;
  admissionNumber: string | null;
  credit: number;
  payments: { id: string; label: string }[];
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

type RowMode = { id: string; mode: "reject" | "payout" | "cancel" } | null;

export function RefundsSection({
  rows,
  candidates,
  canWrite,
  canApprove,
}: {
  rows: RefundRow[];
  candidates: RefundCandidate[];
  canWrite: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  const [studentId, setStudentId] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState<RefundReason | "">("");
  const [note, setNote] = useState("");

  const [rowMode, setRowMode] = useState<RowMode>(null);
  const [rowNote, setRowNote] = useState("");
  const [method, setMethod] = useState<PayoutMethod | "">("");
  const [reference, setReference] = useState("");

  const candidate = useMemo(() => candidates.find((c) => c.studentId === studentId) ?? null, [candidates, studentId]);
  const totals = summarise(rows);

  function finish(result: { error: string } | { success: true }, okText: string, reset?: () => void) {
    if ("error" in result) {
      setMessage({ kind: "error", text: result.error });
      return;
    }
    setMessage({ kind: "ok", text: okText });
    reset?.();
    setRowMode(null);
    setRowNote("");
    setMethod("");
    setReference("");
    router.refresh();
  }

  function submitRequest() {
    const invalid = validateRequestForm({ paymentId, amountText, reason, note });
    if (invalid) return setMessage({ kind: "error", text: invalid });
    setMessage(null);
    startTransition(async () => {
      const result = await createRefundRequestAction({ paymentId, amountText, reason, note });
      finish(result, "Refund requested. It now needs approval. No money has moved.", () => {
        setStudentId("");
        setPaymentId("");
        setAmountText("");
        setReason("");
        setNote("");
      });
    });
  }

  function decide(row: RefundRow, approve: boolean) {
    setMessage(null);
    startTransition(async () => {
      const result = await decideRefundRequestAction({ requestId: row.id, approve, note: rowNote });
      finish(result, approve ? "Approved. Pay the parent, then record the pay-out here." : "Request rejected.");
    });
  }

  function cancel(row: RefundRow) {
    setMessage(null);
    startTransition(async () => {
      const result = await cancelRefundRequestAction({ requestId: row.id, note: rowNote });
      finish(result, "Request cancelled.");
    });
  }

  function payout(row: RefundRow) {
    const invalid = validatePayoutForm({ method, reference });
    if (invalid) return setMessage({ kind: "error", text: invalid });
    const sure = window.confirm(
      `Record that ${kes(row.amount)} was paid out to the parent for ${row.studentName}?\n\nThis reduces the learner's credit balance and cannot be undone.`,
    );
    if (!sure) return;
    setMessage(null);
    startTransition(async () => {
      const result = await recordRefundPayoutAction({ requestId: row.id, method, reference });
      finish(result, "Pay-out recorded. The learner's credit has been reduced.");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="panel p-3 text-sm text-muted-foreground">
        A refund returns <strong>credit</strong>: money a parent paid that is not applied to any invoice (overpayment,
        duplicate or paid in error). EduCore does <strong>not</strong> send the money. Pay the parent by M-Pesa, bank, cash or
        cheque first, then record the pay-out here. Fees already applied to an invoice cannot be refunded from this page.
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="panel px-4 py-3">
          <p className="label-eyebrow">Open requests</p>
          <p className="mt-1 text-xl font-semibold tracking-tight" data-numeric>{totals.openCount}</p>
        </div>
        <div className="panel px-4 py-3">
          <p className="label-eyebrow">Open amount</p>
          <p className="mt-1 text-xl font-semibold tracking-tight" data-numeric>{kes(totals.openAmount)}</p>
        </div>
        <div className="panel px-4 py-3">
          <p className="label-eyebrow">Paid out</p>
          <p className="mt-1 text-xl font-semibold tracking-tight" data-numeric>{totals.paidCount}</p>
        </div>
        <div className="panel px-4 py-3">
          <p className="label-eyebrow">Total paid out</p>
          <p className="mt-1 text-xl font-semibold tracking-tight" data-numeric>{kes(totals.paidAmount)}</p>
        </div>
      </div>

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`panel p-3 text-sm ${message.kind === "error" ? "text-destructive" : ""}`}>
          {message.text}
        </p>
      )}

      {canWrite && (
        <div className="panel flex flex-col gap-3 p-4">
          <h2 className="text-sm font-semibold">Request a refund</h2>
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No learner in this school currently has credit that could be refunded.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rf_student">Learner with credit</Label>
                <select
                  id="rf_student"
                  className={selectClass + " w-full"}
                  value={studentId}
                  onChange={(e) => {
                    setStudentId(e.target.value);
                    setPaymentId("");
                  }}
                >
                  <option value="">Choose a learner</option>
                  {candidates.map((c) => (
                    <option key={c.studentId} value={c.studentId}>
                      {c.name}
                      {c.admissionNumber ? ` (${c.admissionNumber})` : ""} - credit {kes(c.credit)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rf_payment">Payment the credit came from</Label>
                <select id="rf_payment" className={selectClass + " w-full"} value={paymentId} onChange={(e) => setPaymentId(e.target.value)} disabled={!candidate}>
                  <option value="">Choose a payment</option>
                  {(candidate?.payments ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rf_amount">Amount (whole KES)</Label>
                <Input id="rf_amount" inputMode="numeric" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="e.g. 2000" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rf_reason">Reason</Label>
                <select id="rf_reason" className={selectClass + " w-full"} value={reason} onChange={(e) => setReason(e.target.value as RefundReason | "")}>
                  <option value="">Choose a reason</option>
                  {REASON_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="rf_note">Note{reason === "other" ? " (required)" : " (optional)"}</Label>
                <Input id="rf_note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </div>
              <div className="md:col-span-2">
                <Button type="button" onClick={submitRequest} disabled={pending}>
                  {pending ? "Sending…" : "Request refund"}
                </Button>
                <span className="ml-3 text-xs text-muted-foreground">
                  The system checks the amount against the credit actually held on that payment.
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">Requested</th>
              <th className="p-2">Learner</th>
              <th className="p-2 text-right">Amount</th>
              <th className="p-2">Reason</th>
              <th className="p-2">Status</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">No refund requests yet.</td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-b align-top">
                <td className="p-2 whitespace-nowrap">
                  {when(row.requestedAt)}
                  <div className="text-xs text-muted-foreground">{row.requestedBy ?? "Unknown"}</div>
                </td>
                <td className="p-2">
                  {row.studentName}
                  {row.admissionNumber ? <span className="text-muted-foreground"> ({row.admissionNumber})</span> : null}
                  <div className="text-xs text-muted-foreground">From {row.paymentLabel}</div>
                </td>
                <td className="p-2 text-right whitespace-nowrap" data-numeric>{kes(row.amount)}</td>
                <td className="p-2">
                  {reasonLabel(row.reasonCode)}
                  {row.reasonNote ? <div className="text-xs text-muted-foreground">{row.reasonNote}</div> : null}
                </td>
                <td className="p-2">
                  {statusLabel(row.status)}
                  {row.decidedBy && row.status !== "requested" ? <div className="text-xs text-muted-foreground">by {row.decidedBy}</div> : null}
                  {row.decisionNote ? <div className="text-xs text-muted-foreground">{row.decisionNote}</div> : null}
                  {row.payout ? (
                    <div className="text-xs text-muted-foreground">
                      {methodLabel(row.payout.method)} {row.payout.reference}, {when(row.payout.paidAt)}
                      {row.payout.paidBy ? ` by ${row.payout.paidBy}` : ""}
                    </div>
                  ) : null}
                </td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-2">
                    {canDecide(row.status) && canApprove && (
                      <>
                        <Button type="button" size="sm" disabled={pending} onClick={() => decide(row, true)}>Approve</Button>
                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { setRowMode({ id: row.id, mode: "reject" }); setRowNote(""); }}>Reject</Button>
                      </>
                    )}
                    {canRecordPayout(row.status) && canWrite && (
                      <Button type="button" size="sm" disabled={pending} onClick={() => { setRowMode({ id: row.id, mode: "payout" }); setMethod(""); setReference(""); }}>Record pay-out</Button>
                    )}
                    {canCancel(row.status) && canWrite && (
                      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { setRowMode({ id: row.id, mode: "cancel" }); setRowNote(""); }}>Cancel</Button>
                    )}
                  </div>

                  {rowMode?.id === row.id && rowMode.mode === "reject" && (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <Input aria-label="Reason for rejecting" placeholder="Reason for rejecting (required)" value={rowNote} onChange={(e) => setRowNote(e.target.value)} maxLength={500} />
                      <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => decide(row, false)}>Confirm reject</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setRowMode(null)}>Back</Button>
                    </div>
                  )}
                  {rowMode?.id === row.id && rowMode.mode === "cancel" && (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <Input aria-label="Note for cancelling" placeholder="Note (optional)" value={rowNote} onChange={(e) => setRowNote(e.target.value)} maxLength={500} />
                      <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => cancel(row)}>Confirm cancel</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setRowMode(null)}>Back</Button>
                    </div>
                  )}
                  {rowMode?.id === row.id && rowMode.mode === "payout" && (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <select aria-label="How it was paid" className={selectClass} value={method} onChange={(e) => setMethod(e.target.value as PayoutMethod | "")}>
                        <option value="">How was it paid?</option>
                        {METHOD_OPTIONS.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                      <Input
                        aria-label="Payment reference"
                        placeholder={METHOD_OPTIONS.find((m) => m.value === method)?.referenceHint ?? "Reference"}
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        maxLength={100}
                      />
                      <Button type="button" size="sm" disabled={pending} onClick={() => payout(row)}>Record pay-out</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setRowMode(null)}>Back</Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
