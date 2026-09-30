"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { transferStudent } from "@/app/(app)/boarding/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { StudentCombobox } from "@/components/shared/student-combobox";
import { useServerTableParams } from "@/hooks/use-server-table-params";
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

/**
 * `transfers` arrives already paginated/searched server-side (see
 * getTransfersPage) -- same useServerTableParams pattern as
 * allocation-section.tsx. Doesn't touch loadBoardingContext.
 */
function TransfersSectionInner({
  transfers,
  totalCount,
  pageSize,
  boardingStudents,
  availableBeds,
  canWrite,
}: {
  transfers: TransferRow[];
  totalCount: number;
  pageSize: number;
  boardingStudents: StudentOption[];
  availableBeds: AvailableBedOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const { pageIndex, pageCount, onPageChange, search, onSearchChange } = useServerTableParams({
    totalCount,
    pageSize,
  });
  const page = pageIndex + 1;
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        {canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">Transfer student</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Transfer a boarding student</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <StudentCombobox
                  students={boardingStudents}
                  value={studentId}
                  onChange={setStudentId}
                  placeholder="Currently boarding student"
                />
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
        <Input
          placeholder="Search by student name or admission number…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="max-w-xs"
        />
      </div>

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
                  No transfers {search ? "match this search" : "on record"}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>
          {totalCount === 0
            ? ""
            : `Showing ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, totalCount)} of ${totalCount}`}
        </span>
        {pageCount > 1 && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(pageIndex - 1)}>
              Previous
            </Button>
            <span>
              Page {page} of {pageCount}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= pageCount}
              onClick={() => onPageChange(pageIndex + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function TransfersSection(props: {
  transfers: TransferRow[];
  totalCount: number;
  pageSize: number;
  boardingStudents: StudentOption[];
  availableBeds: AvailableBedOption[];
  canWrite: boolean;
}) {
  return (
    <Suspense fallback={null}>
      <TransfersSectionInner {...props} />
    </Suspense>
  );
}
