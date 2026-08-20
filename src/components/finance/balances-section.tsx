"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { recordPaymentAction, createInvoiceForStudentAction } from "@/app/(app)/finance/actions";
import type { StudentOption } from "@/components/finance/waivers-section";

export interface BalanceRow {
  student_id: string;
  full_name: string;
  admission_number: string;
  payment_reference: string | null;
  class_name: string;
  total_invoiced: number;
  total_discounted: number;
  total_paid: number;
  balance: number;
  credit_balance: number;
}

type Method = "mpesa" | "cash" | "bank" | "cheque" | "card" | "other";

export function BalancesSection({
  rows,
  canWrite,
  students,
  activeTermId,
}: {
  rows: BalanceRow[];
  canWrite: boolean;
  students: StudentOption[];
  activeTermId: string | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<BalanceRow | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("mpesa");
  const [reference, setReference] = useState("");
  const [phone, setPhone] = useState("");
  const [purpose, setPurpose] = useState("");
  const [notes, setNotes] = useState("");

  const [genOpen, setGenOpen] = useState(false);
  const [genStudentId, setGenStudentId] = useState("");
  const [genPending, setGenPending] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  async function handleGenerateInvoice() {
    if (!genStudentId || !activeTermId) return;
    setGenPending(true);
    setGenError(null);
    const result = await createInvoiceForStudentAction(genStudentId, activeTermId);
    setGenPending(false);
    if ("error" in result) return setGenError(result.error);
    setGenOpen(false);
    setGenStudentId("");
    router.refresh();
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        r.admission_number.toLowerCase().includes(q) ||
        (r.payment_reference ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

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
      purpose: purpose || undefined,
      notes: notes || undefined,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setTarget(null);
    setAmount("");
    setReference("");
    setPhone("");
    setPurpose("");
    setNotes("");
    router.refresh();
  }

  const genDialog = (
    <Dialog open={genOpen} onOpenChange={(o) => { setGenOpen(o); if (!o) { setGenStudentId(""); setGenError(null); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate invoice</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {activeTermId ? (
            <div className="space-y-1.5">
              <Label>Student</Label>
              <Select value={genStudentId} onValueChange={setGenStudentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a student" />
                </SelectTrigger>
                <SelectContent>
                  {students.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Applies the active term&apos;s fee structure. If this student already has an invoice for the
                active term, nothing new is created — you&apos;ll just see the existing one.
              </p>
            </div>
          ) : (
            <p className="text-sm text-danger">No active term — set one in Academics before generating invoices.</p>
          )}
          {genError && <p className="text-sm text-danger">{genError}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleGenerateInvoice} disabled={genPending || !genStudentId || !activeTermId}>
            {genPending ? "Generating…" : "Generate invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
          No invoices generated yet — student accounts appear once invoices exist.
          {canWrite && (
            <div className="mt-4">
              <Button variant="secondary" onClick={() => setGenOpen(true)}>
                Generate invoice for a student
              </Button>
            </div>
          )}
        </div>
        {genDialog}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Input
          placeholder="Search by name, admission number, or payment reference…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        {canWrite && (
          <Button variant="secondary" onClick={() => setGenOpen(true)}>
            Generate invoice
          </Button>
        )}
      </div>
      {genDialog}

      <div className="panel overflow-x-auto">
        <Table className="table-dense">
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            <TableHead>Payment ref.</TableHead>
            <TableHead>Class</TableHead>
            <TableHead>Invoiced</TableHead>
            <TableHead>Discounted</TableHead>
            <TableHead>Paid</TableHead>
            <TableHead>Balance</TableHead>
            <TableHead>Credit</TableHead>
            {canWrite && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((r) => (
            <TableRow key={r.student_id}>
              <TableCell className="font-medium">
                {r.full_name}
                <span className="block text-xs text-muted-foreground">{r.admission_number}</span>
              </TableCell>
              <TableCell className="font-mono text-xs">{r.payment_reference ?? "—"}</TableCell>
              <TableCell>{r.class_name}</TableCell>
              <TableCell data-numeric>{r.total_invoiced.toLocaleString()}</TableCell>
              <TableCell data-numeric>{r.total_discounted.toLocaleString()}</TableCell>
              <TableCell data-numeric>{r.total_paid.toLocaleString()}</TableCell>
              <TableCell className={r.balance > 0 ? "font-medium text-danger" : "text-success"} data-numeric>
                {r.balance.toLocaleString()}
              </TableCell>
              <TableCell className={r.credit_balance > 0 ? "font-medium text-success" : "text-muted-foreground"} data-numeric>
                {r.credit_balance.toLocaleString()}
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
              Payment ref. {target?.payment_reference ?? "—"} · Outstanding: KES {target?.balance.toLocaleString()}
              {target && target.credit_balance > 0 ? ` · Credit available: KES ${target.credit_balance.toLocaleString()}` : ""}.
              Applies to the oldest outstanding invoice first; any remainder is kept as credit.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as Method)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mpesa">M-Pesa</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="bank">Bank</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {method === "mpesa" ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                <Label>External reference (optional)</Label>
                <Input placeholder="Cheque / transaction / bank slip number" value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Purpose (optional)</Label>
              <Input placeholder="e.g. Term 2 fees" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
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
