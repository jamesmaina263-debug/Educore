"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { createFeeWaiverAction, revokeFeeWaiverAction } from "@/app/finance/actions";

export interface FeeWaiverRow {
  id: string;
  student_name: string;
  name: string;
  waiver_type: string;
  discount_kind: "percentage" | "fixed_amount";
  discount_value: number;
  status: "active" | "expired" | "revoked";
  starts_term_name: string | null;
  ends_term_name: string | null;
}

export interface StudentOption {
  id: string;
  name: string;
}

export interface TermOption {
  id: string;
  name: string;
}

const WAIVER_TYPES = [
  { value: "scholarship", label: "Scholarship" },
  { value: "bursary", label: "Bursary" },
  { value: "staff_discount", label: "Staff discount" },
  { value: "sibling_discount", label: "Sibling discount" },
  { value: "other", label: "Other" },
] as const;

export function WaiversSection({
  waivers,
  students,
  terms,
  canManage,
}: {
  waivers: FeeWaiverRow[];
  students: StudentOption[];
  terms: TermOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [studentId, setStudentId] = useState("");
  const [name, setName] = useState("");
  const [waiverType, setWaiverType] = useState<string>("scholarship");
  const [discountKind, setDiscountKind] = useState<string>("percentage");
  const [discountValue, setDiscountValue] = useState("");
  const [startsTermId, setStartsTermId] = useState("");
  const [notes, setNotes] = useState("");

  async function handleCreate() {
    setPending(true);
    setError(null);
    const result = await createFeeWaiverAction({
      student_id: studentId,
      name,
      waiver_type: waiverType as "scholarship" | "bursary" | "staff_discount" | "sibling_discount" | "other",
      discount_kind: discountKind as "percentage" | "fixed_amount",
      discount_value: Number(discountValue),
      starts_term_id: startsTermId || undefined,
      notes: notes || undefined,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setStudentId("");
    setName("");
    setDiscountValue("");
    setStartsTermId("");
    setNotes("");
    router.refresh();
  }

  async function handleRevoke(id: string) {
    setPending(true);
    const result = await revokeFeeWaiverAction(id);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Durable scholarship/bursary grants that apply automatically to every invoice generated while
        active — distinct from one-off discounts.
      </p>
      {error && <p className="text-sm text-danger">{error}</p>}

      {canManage && (
        <div className="flex justify-end">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                Grant waiver
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Grant a fee waiver</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Student</Label>
                  <Select value={studentId} onValueChange={setStudentId}>
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
                </div>
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. County Bursary 2026"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Type</Label>
                    <Select value={waiverType} onValueChange={setWaiverType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WAIVER_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Kind</Label>
                    <Select value={discountKind} onValueChange={setDiscountKind}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage">Percentage</SelectItem>
                        <SelectItem value="fixed_amount">Fixed amount (KES)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>{discountKind === "percentage" ? "Percentage (0-100)" : "Amount (KES)"}</Label>
                  <Input type="number" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Starts from term (optional — blank applies immediately)</Label>
                  <Select value={startsTermId} onValueChange={setStartsTermId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Any term" />
                    </SelectTrigger>
                    <SelectContent>
                      {terms.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Notes (optional)</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
                </div>
                {error && <p className="text-sm text-danger">{error}</p>}
              </div>
              <DialogFooter>
                <Button onClick={handleCreate} disabled={pending || !studentId || !name.trim() || !discountValue}>
                  {pending ? "Granting…" : "Grant waiver"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {waivers.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No fee waivers granted yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>From term</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {waivers.map((w) => (
              <TableRow key={w.id}>
                <TableCell className="font-medium">{w.student_name}</TableCell>
                <TableCell>{w.name}</TableCell>
                <TableCell>{w.waiver_type.replace("_", " ")}</TableCell>
                <TableCell>
                  {w.discount_kind === "percentage" ? `${w.discount_value}%` : `KES ${w.discount_value.toLocaleString()}`}
                </TableCell>
                <TableCell>{w.starts_term_name ?? "Any"}</TableCell>
                <TableCell>
                  <Badge variant={w.status === "active" ? "success" : "danger"}>{w.status}</Badge>
                </TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    {w.status === "active" && (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleRevoke(w.id)}>
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
