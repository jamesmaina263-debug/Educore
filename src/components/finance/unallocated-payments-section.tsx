"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { allocateUnallocatedPaymentAction, recordUnallocatedPaymentAction, searchStudentAccountsAction } from "@/app/finance/actions";

export interface UnallocatedPaymentRow {
  id: string;
  method: "mpesa" | "cash" | "bank" | "cheque" | "card" | "other";
  amount: number;
  reference: string | null;
  phone_number: string | null;
  purpose: string | null;
  notes: string | null;
  recorded_at: string;
}

type Method = UnallocatedPaymentRow["method"];
type SearchResult = { student_id: string; full_name: string; admission_number: string; payment_reference: string };

export function UnallocatedPaymentsSection({ payments, canWrite }: { payments: UnallocatedPaymentRow[]; canWrite: boolean }) {
  const router = useRouter();

  // Record new unallocated payment
  const [recordOpen, setRecordOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("mpesa");
  const [reference, setReference] = useState("");
  const [phone, setPhone] = useState("");
  const [purpose, setPurpose] = useState("");
  const [notes, setNotes] = useState("");
  const [recordPending, setRecordPending] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);

  // Allocate existing unallocated payment
  const [target, setTarget] = useState<UnallocatedPaymentRow | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [allocatePending, setAllocatePending] = useState(false);
  const [allocateError, setAllocateError] = useState<string | null>(null);

  async function handleRecord() {
    setRecordPending(true);
    setRecordError(null);
    const result = await recordUnallocatedPaymentAction({
      method,
      amount: Number(amount),
      reference: reference || undefined,
      phone_number: phone || undefined,
      purpose: purpose || undefined,
      notes: notes || undefined,
    });
    setRecordPending(false);
    if ("error" in result) return setRecordError(result.error);
    setRecordOpen(false);
    setAmount("");
    setReference("");
    setPhone("");
    setPurpose("");
    setNotes("");
    router.refresh();
  }

  async function handleSearch(q: string) {
    setQuery(q);
    setSelected(null);
    if (q.trim().length < 2) return setResults([]);
    setSearching(true);
    const result = await searchStudentAccountsAction(q);
    setSearching(false);
    if ("error" in result) return setResults([]);
    setResults(result.results);
  }

  async function handleAllocate() {
    if (!target || !selected) return;
    setAllocatePending(true);
    setAllocateError(null);
    const result = await allocateUnallocatedPaymentAction({ payment_id: target.id, student_id: selected.student_id });
    setAllocatePending(false);
    if ("error" in result) return setAllocateError(result.error);
    setTarget(null);
    setQuery("");
    setResults([]);
    setSelected(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Payments that couldn&apos;t be confidently matched to a student on entry — investigate and allocate, or
          leave here until the payer is identified. Nothing here counts toward any student&apos;s balance yet.
        </p>
        {canWrite && <Button size="sm" onClick={() => setRecordOpen(true)}>Record unallocated payment</Button>}
      </div>

      {payments.length === 0 ? (
        <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
          Nothing unallocated — every recorded payment is matched to a student.
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <Table className="table-dense">
            <TableHeader>
              <TableRow>
                <TableHead>Method</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Purpose / notes</TableHead>
                <TableHead>Recorded</TableHead>
                {canWrite && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Badge variant="outline">{p.method}</Badge>
                  </TableCell>
                  <TableCell data-numeric>{p.amount.toLocaleString()}</TableCell>
                  <TableCell>{p.reference ?? "—"}</TableCell>
                  <TableCell>{p.phone_number ?? "—"}</TableCell>
                  <TableCell>{[p.purpose, p.notes].filter(Boolean).join(" — ") || "—"}</TableCell>
                  <TableCell>{new Date(p.recorded_at).toLocaleDateString()}</TableCell>
                  {canWrite && (
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setTarget(p)}>
                        Allocate
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Record dialog */}
      <Dialog open={recordOpen} onOpenChange={setRecordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record unallocated payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>External reference (optional)</Label>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone number (optional)</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Purpose (optional)</Label>
              <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {recordError && <p className="text-sm text-danger">{recordError}</p>}
          </div>
          <DialogFooter>
            <Button onClick={handleRecord} disabled={recordPending || !amount || Number(amount) <= 0}>
              {recordPending ? "Recording…" : "Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Allocate dialog */}
      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Allocate payment — KES {target?.amount.toLocaleString()}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Search by name, admission number, or payment reference</Label>
              <Input value={query} onChange={(e) => handleSearch(e.target.value)} />
            </div>
            {searching && <p className="text-sm text-muted-foreground">Searching…</p>}
            {results.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md border">
                {results.map((r) => (
                  <button
                    key={r.student_id}
                    type="button"
                    onClick={() => { setSelected(r); setQuery(r.full_name); setResults([]); }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    {r.full_name} <span className="text-xs text-muted-foreground">{r.admission_number} · {r.payment_reference}</span>
                  </button>
                ))}
              </div>
            )}
            {selected && (
              <p className="text-sm">
                Will allocate to <span className="font-medium">{selected.full_name}</span> ({selected.payment_reference}),
                applied to their oldest outstanding invoice first; any remainder becomes credit.
              </p>
            )}
            {allocateError && <p className="text-sm text-danger">{allocateError}</p>}
          </div>
          <DialogFooter>
            <Button onClick={handleAllocate} disabled={allocatePending || !selected}>
              {allocatePending ? "Allocating…" : "Allocate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
