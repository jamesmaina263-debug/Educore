"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { allocateStudentToBed, endAllocation } from "@/app/boarding/actions";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export interface StudentOption {
  id: string;
  name: string;
  gender: string;
}

export interface AvailableBedOption {
  id: string;
  label: string; // "House A > Dorm 1 > Room 3 > Bed 2"
  gender: string;
}

export interface AllocationRow {
  id: string;
  student_name: string;
  bed_label: string;
  start_date: string;
  end_date: string | null;
  status: "active" | "ended";
}

export function AllocationSection({
  allocations,
  studentOptions,
  availableBeds,
  canWrite,
}: {
  allocations: AllocationRow[];
  studentOptions: StudentOption[];
  availableBeds: AvailableBedOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [bedId, setBedId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    const result = await allocateStudentToBed({ student_id: studentId, bed_id: bedId });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setStudentId("");
    setBedId("");
    router.refresh();
  }

  async function end(allocationId: string) {
    setPending(true);
    await endAllocation(allocationId);
    setPending(false);
    router.refresh();
  }

  const visible = allocations.filter((a) => (showHistory ? true : a.status === "active"));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        {canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">Allocate bed</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Allocate a boarding bed</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Select value={studentId} onValueChange={setStudentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select student" />
                  </SelectTrigger>
                  <SelectContent>
                    {studentOptions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={bedId} onValueChange={setBedId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an available bed" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableBeds.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {error && <p className="text-sm text-danger">{error}</p>}
              </div>
              <DialogFooter>
                <Button onClick={submit} disabled={pending || !studentId || !bedId}>
                  {pending ? "Allocating…" : "Allocate"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        <Button size="sm" variant="ghost" onClick={() => setShowHistory(!showHistory)}>
          {showHistory ? "Hide history" : "Show full history"}
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="table-dense w-full">
          <thead>
            <tr>
              <th className="text-left">Student</th>
              <th className="text-left">Bed</th>
              <th className="text-left">Start date</th>
              <th className="text-left">End date</th>
              <th className="text-left">Status</th>
              {canWrite && <th />}
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => (
              <tr key={a.id}>
                <td>{a.student_name}</td>
                <td>{a.bed_label}</td>
                <td>{a.start_date}</td>
                <td>{a.end_date ?? "—"}</td>
                <td>
                  <StatusBadge tone={a.status === "active" ? "success" : "neutral"} label={a.status} />
                </td>
                {canWrite && (
                  <td>
                    {a.status === "active" && (
                      <Button size="sm" variant="ghost" onClick={() => end(a.id)} disabled={pending}>
                        End
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted-foreground">
                  No {showHistory ? "" : "active "}allocations.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
