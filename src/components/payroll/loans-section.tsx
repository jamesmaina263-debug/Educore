"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { formatKes } from "@/lib/billing/format";
import { approveLoanAction, cancelLoanAction, createLoanAction, dueAction, repaymentAction, writeOffAction } from "@/app/(app)/payroll/loans/actions";
import {
  KIND_LABELS,
  LOAN_KINDS,
  MONTH_NAMES,
  STATUS_LABELS,
  expectedLastPeriod,
  formatPeriod,
  monthsToClear,
  type DueResult,
  type LoanKind,
  type LoanStatus,
} from "@/lib/staff-loans";

export interface LoanRow {
  id: string;
  staffId: string;
  staffName: string;
  kind: LoanKind;
  principal: number;
  installment: number;
  firstYear: number;
  firstMonth: number;
  reason: string;
  status: LoanStatus;
  agreementOn: string | null;
  createdByMe: boolean;
  isMine: boolean;
  repaid: number;
  balance: number;
  closedReason: string | null;
}
export interface EntryRow {
  id: string;
  loanId: string;
  kind: "repayment" | "manual_repayment" | "write_off";
  amount: number;
  periodYear: number | null;
  periodMonth: number | null;
  note: string | null;
  createdAt: string;
}
export interface DraftRecord {
  id: string;
  label: string;
}

const ENTRY_LABELS: Record<EntryRow["kind"], string> = { repayment: "Deducted in payroll", manual_repayment: "Repaid by hand", write_off: "Written off" };
const makeRef = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `r${Date.now()}${Math.random().toString(36).slice(2)}`);
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

function tone(s: LoanStatus): "success" | "warning" | "neutral" | "info" {
  return s === "active" ? "success" : s === "pending" ? "warning" : s === "paid_off" ? "info" : "neutral";
}

export function LoansSection({
  loans,
  entries,
  staff,
  drafts,
  canWrite,
  canApprove,
  today,
}: {
  loans: LoanRow[];
  entries: EntryRow[];
  staff: { id: string; name: string }[];
  drafts: DraftRecord[];
  canWrite: boolean;
  canApprove: boolean;
  today: string;
}) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const [form, setForm] = useState<{ staffId: string; kind: LoanKind; principal: string; installment: string; firstYear: number; firstMonth: number; reason: string } | null>(null);
  const [action, setAction] = useState<{ id: string; type: "approve" | "cancel" | "writeoff" | "repay" | "history"; text: string; amount: string; note: string } | null>(null);
  const [recordId, setRecordId] = useState("");
  const [due, setDue] = useState<DueResult | null>(null);
  const [repayRef, setRepayRef] = useState<{ ref: string; fp: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run<T extends { success: true }>(fn: () => Promise<{ error: string } | T>, ok: (r: T) => string, after?: () => void) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fn();
      if ("error" in r) setError(r.error);
      else {
        setNotice(ok(r));
        after?.();
      }
    } finally {
      setBusy(false);
    }
  }

  const owed = loans.filter((l) => l.status === "active").reduce((n, l) => n + l.balance, 0);

  return (
    <div className="flex flex-col gap-6">
      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      {notice && <p className="rounded-md border p-2 text-sm">{notice}</p>}

      <div className="panel p-4">
        <p className="mb-1 text-sm font-semibold">What is due on a payslip</p>
        <p className="mb-3 text-sm text-muted-foreground">
          Pick a draft payslip to see the instalment that can lawfully be deducted. Enter it as a deduction on the payslip yourself, then record
          the repayment below once it has been deducted. Total deductions can never pass two-thirds of wages, and a loan can never pass half of
          the pay left, so the amount may be less than the monthly deduction.
        </p>
        {drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">There are no draft payslips. Generate one in Payroll first.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-64 grow">
              <Label htmlFor="d-rec">Draft payslip</Label>
              <select id="d-rec" className={selectClass} value={recordId} onChange={(e) => { setRecordId(e.target.value); setDue(null); }}>
                <option value="">Choose...</option>
                {drafts.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </div>
            <Button disabled={busy || !recordId || !canWrite} onClick={() => void run(() => dueAction(recordId), (r) => {
              setDue(r.due);
              return "Worked out. Nothing has been changed.";
            })}>Work out what is due</Button>
          </div>
        )}
        {due && (
          <div className="mt-3 rounded-md border p-3 text-sm">
            {due.total === 0 ? (
              <p>Nothing is due on this payslip.</p>
            ) : (
              <>
                {due.lines.map((l) => <p key={l.loanId}><span className="font-medium">{l.name}</span>: {formatKes(l.amount)}</p>)}
                <p className="mt-1 font-medium">Total to deduct: {formatKes(due.total)}</p>
                {due.capped && <p className="mt-1 text-muted-foreground">This is less than the full monthly deduction because of the legal limit on deductions from wages. The rest stays owed.</p>}
              </>
            )}
          </div>
        )}
      </div>

      <div className="panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Loans and advances</p>
            <p className="text-xs text-muted-foreground">Still owed on active loans: {formatKes(owed)}</p>
          </div>
          {canWrite && !form && <Button size="sm" onClick={() => setForm({ staffId: "", kind: "loan", principal: "", installment: "", firstYear: year, firstMonth: month, reason: "" })}>New loan or advance</Button>}
        </div>
        {form && (
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Label htmlFor="l-staff">Staff member</Label>
              <select id="l-staff" className={selectClass} value={form.staffId} onChange={(e) => setForm({ ...form, staffId: e.target.value })}>
                <option value="">Choose...</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="l-kind">Type</Label>
              <select id="l-kind" className={selectClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as LoanKind })}>
                {LOAN_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
              </select>
            </div>
            <div><Label htmlFor="l-principal">Amount lent (KES)</Label><Input id="l-principal" inputMode="decimal" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} /></div>
            <div><Label htmlFor="l-inst">Monthly deduction (KES)</Label><Input id="l-inst" inputMode="decimal" value={form.installment} onChange={(e) => setForm({ ...form, installment: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="l-month">First deduction</Label>
                <select id="l-month" className={selectClass} value={form.firstMonth} onChange={(e) => setForm({ ...form, firstMonth: Number(e.target.value) })}>
                  {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div><Label htmlFor="l-year">Year</Label><Input id="l-year" type="number" value={form.firstYear} onChange={(e) => setForm({ ...form, firstYear: Number(e.target.value) })} /></div>
            </div>
            <div className="sm:col-span-3"><Label htmlFor="l-reason">Reason (optional)</Label><Textarea id="l-reason" rows={2} maxLength={200} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
            <p className="text-xs text-muted-foreground sm:col-span-3">It starts as waiting for approval. A different person with approval rights activates it, and they need the date the staff member signed the written agreement.</p>
            <div className="flex gap-2 sm:col-span-3">
              <Button disabled={busy} onClick={() => run(() => createLoanAction(form), () => "Saved. It is waiting for approval.", () => setForm(null))}>{busy ? "Saving..." : "Save"}</Button>
              <Button variant="outline" disabled={busy} onClick={() => setForm(null)}>Close</Button>
            </div>
          </div>
        )}
        {loans.length === 0 ? (
          <p className="text-sm text-muted-foreground">No loans or advances yet.</p>
        ) : (
          <ul className="divide-y">
            {loans.map((l) => {
              const months = monthsToClear(l.balance, l.installment);
              // deductions start at the first deduction month, or this month if that has passed
              const startIndex = Math.max(l.firstYear * 12 + l.firstMonth - 1, year * 12 + month - 1);
              const last = l.status === "active" ? expectedLastPeriod(Math.floor(startIndex / 12), (startIndex % 12) + 1, months) : null;
              const open = action?.id === l.id ? action : null;
              const history = entries.filter((e) => e.loanId === l.id);
              return (
                <li key={l.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{l.staffName} · {KIND_LABELS[l.kind]} of {formatKes(l.principal)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatKes(l.installment)} a month from {formatPeriod(l.firstYear, l.firstMonth)}
                        {l.status === "active" || l.status === "paid_off" ? ` · owed ${formatKes(l.balance)} · repaid ${formatKes(l.repaid)}` : ""}
                        {last ? ` · about ${months} more ${months === 1 ? "deduction" : "deductions"}, to ${formatPeriod(last.year, last.month)}` : ""}
                      </p>
                      {l.reason && <p className="text-xs text-muted-foreground">{l.reason}</p>}
                      {l.agreementOn && <p className="text-xs text-muted-foreground">Written agreement dated {l.agreementOn}</p>}
                      {l.status === "cancelled" && l.closedReason && <p className="text-xs text-muted-foreground">Cancelled: {l.closedReason}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={tone(l.status)} label={STATUS_LABELS[l.status]} />
                      <Button size="sm" variant="outline" onClick={() => setAction(open?.type === "history" ? null : { id: l.id, type: "history", text: "", amount: "", note: "" })}>History</Button>
                      {l.status === "pending" && canApprove && !l.createdByMe && !l.isMine && <Button size="sm" onClick={() => setAction({ id: l.id, type: "approve", text: "", amount: "", note: "" })}>Approve</Button>}
                      {l.status === "pending" && canApprove && (l.createdByMe || l.isMine) && <span className="text-xs text-muted-foreground">Needs someone else to approve</span>}
                      {l.status === "pending" && canWrite && <Button size="sm" variant="outline" onClick={() => setAction({ id: l.id, type: "cancel", text: "", amount: "", note: "" })}>Cancel</Button>}
                      {l.status === "active" && canWrite && <Button size="sm" variant="outline" onClick={() => setAction({ id: l.id, type: "repay", text: "", amount: "", note: "" })}>Record repayment</Button>}
                      {l.status === "active" && canApprove && !l.isMine && l.balance > 0 && <Button size="sm" variant="outline" onClick={() => setAction({ id: l.id, type: "writeoff", text: "", amount: "", note: "" })}>Write off</Button>}
                    </div>
                  </div>
                  {open && open.type === "approve" && (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <div><Label htmlFor={`a-${l.id}`}>Date the written agreement was signed</Label><Input id={`a-${l.id}`} type="date" max={today} value={open.text} onChange={(e) => setAction({ ...open, text: e.target.value })} /></div>
                      <Button size="sm" disabled={busy} onClick={() => run(() => approveLoanAction(l.id, open.text, today), () => "Approved. It is now active.", () => setAction(null))}>Confirm approval</Button>
                      <Button size="sm" variant="outline" onClick={() => setAction(null)}>Cancel</Button>
                    </div>
                  )}
                  {open && (open.type === "cancel" || open.type === "writeoff") && (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <div className="grow"><Label htmlFor={`r-${l.id}`}>{open.type === "cancel" ? "Why is it being cancelled?" : `Reason for writing off the ${formatKes(l.balance)} left`}</Label><Input id={`r-${l.id}`} maxLength={200} value={open.text} onChange={(e) => setAction({ ...open, text: e.target.value })} /></div>
                      <Button size="sm" disabled={busy} onClick={() => (open.type === "cancel"
                        ? run(() => cancelLoanAction(l.id, open.text), () => "Cancelled.", () => setAction(null))
                        : run(() => writeOffAction(l.id, open.text), (r) => `Written off ${formatKes(r.amount)}.`, () => setAction(null)))}>Confirm</Button>
                      <Button size="sm" variant="outline" onClick={() => setAction(null)}>Back</Button>
                    </div>
                  )}
                  {open && open.type === "repay" && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-4">
                      <div><Label htmlFor={`p-${l.id}`}>Amount (KES)</Label><Input id={`p-${l.id}`} inputMode="decimal" value={open.amount} onChange={(e) => setAction({ ...open, amount: e.target.value })} /></div>
                      <div className="sm:col-span-2"><Label htmlFor={`n-${l.id}`}>Note (for example: deducted in the May payroll)</Label><Input id={`n-${l.id}`} maxLength={200} value={open.note} onChange={(e) => setAction({ ...open, note: e.target.value })} /></div>
                      <div className="flex items-end gap-2">
                        <Button size="sm" disabled={busy} onClick={() => {
                          const fp = JSON.stringify({ id: l.id, a: open.amount, n: open.note });
                          const ref = repayRef && repayRef.fp === fp ? repayRef : { ref: makeRef(), fp };
                          setRepayRef(ref);
                          void run(() => repaymentAction(l.id, open.amount, open.note, ref.ref), (r) => `${r.duplicate ? "Already recorded. " : "Recorded. "}Still owed: ${formatKes(r.balance)}.`, () => { setAction(null); setRepayRef(null); });
                        }}>Record</Button>
                        <Button size="sm" variant="outline" onClick={() => setAction(null)}>Back</Button>
                      </div>
                    </div>
                  )}
                  {open && open.type === "history" && (
                    history.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nothing repaid yet.</p> : (
                      <ul className="mt-2 divide-y rounded-md border">
                        {history.map((e) => (
                          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
                            <span>{ENTRY_LABELS[e.kind]}{e.periodYear && e.periodMonth ? ` (${formatPeriod(e.periodYear, e.periodMonth)})` : ""}{e.note ? <span className="text-muted-foreground"> · {e.note}</span> : null}</span>
                            <span>{formatKes(e.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
