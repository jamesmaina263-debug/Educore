"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { transferStudent } from "@/app/boarding/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { StudentOption, AvailableBedOption } from "./allocation-section";

export interface TransferRow {
  id: string;
  student_name: string;
  from_bed_label: string | null;
  to_bed_label: string;
  transfer_date: string;
  reason: string | null;
  authorized_by_name: string | null;
}

export function TransfersSection({
  transfers,
  boardingStudents,
  availableBeds,
  canWrite,
}: {
  transfers: TransferRow[];
  boardingStudents: StudentOption[];
  availableBeds: AvailableBedOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [bedId, setBedId] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    const result = await transferStudent({ student_id: studentId, to_bed_id: bedId, reason: reason || undefined });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setStudentId("");
    setBedId("");
    setReason("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {canWrite && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="self-start">
              Transfer student
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Transfer a boarding student</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Select value={studentId} onValueChange={setStudentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Currently boarding student" />
                </SelectTrigger>
                <SelectContent>
                  {boardingStudents.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={bedId} onValueChange={setBedId}>
                <SelectTrigger>
                  <SelectValue placeholder="Transfer to bed" />
                </SelectTrigger>
                <SelectContent>
                  {availableBeds.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
              {error && <p className="text-sm text-danger">{error}</p>}
            </div>
            <DialogFooter>
              <Button onClick={submit} disabled={pending || !studentId || !bedId}>
                {pending ? "Transferring…" : "Transfer"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <div className="overflow-x-auto">
        <table className="table-dense w-full">
          <thead>
            <tr>
              <th className="text-left">Student</th>
              <th className="text-left">From</th>
              <th className="text-left">To</th>
              <th className="text-left">Date</th>
              <th className="text-left">Reason</th>
              <th className="text-left">Authorized by</th>
            </tr>
          </thead>
          <tbody>
            {transfers.map((t) => (
              <tr key={t.id}>
                <td>{t.student_name}</td>
                <td className="text-muted-foreground">{t.from_bed_label ?? "—"}</td>
                <td>{t.to_bed_label}</td>
                <td>{t.transfer_date}</td>
                <td className="text-muted-foreground">{t.reason ?? "—"}</td>
                <td className="text-muted-foreground">{t.authorized_by_name ?? "—"}</td>
              </tr>
            ))}
            {transfers.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted-foreground">
                  No transfers on record.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
