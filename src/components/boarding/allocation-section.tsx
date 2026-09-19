"use client";

import { Suspense, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { allocateStudentToBed, endAllocation } from "@/app/(app)/boarding/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { StudentCombobox } from "@/components/shared/student-combobox";
import { useServerTableParams } from "@/hooks/use-server-table-params";

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

/**
 * `allocations` arrives already paginated/searched/status-filtered
 * server-side (see getAllocationsPage) -- URL-driven via
 * useServerTableParams, same hook balances-section.tsx/payments-section.tsx
 * use. This does NOT touch loadBoardingContext's own allocations fetch,
 * which still feeds bed-occupancy/current-roster/dashboard logic unchanged.
 */
function AllocationSectionInner({
  allocations,
  totalCount,
  pageSize,
  showHistory,
  studentOptions,
  availableBeds,
  canWrite,
}: {
  allocations: AllocationRow[];
  totalCount: number;
  pageSize: number;
  showHistory: boolean;
  studentOptions: StudentOption[];
  availableBeds: AvailableBedOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { pageIndex, pageCount, onPageChange, search, onSearchChange } = useServerTableParams({
    totalCount,
    pageSize,
  });
  const page = pageIndex + 1;
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [bedId, setBedId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleHistory() {
    const params = new URLSearchParams(searchParams.toString());
    if (showHistory) params.delete("status");
    else params.set("status", "all");
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
                <StudentCombobox
                  students={studentOptions}
                  value={studentId}
                  onChange={setStudentId}
                  placeholder="Select student"
                />
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
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder="Search by student name or admission number…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="max-w-xs"
          />
          <Button size="sm" variant="ghost" onClick={toggleHistory}>
            {showHistory ? "Hide history" : "Show full history"}
          </Button>
        </div>
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
            {allocations.map((a) => (
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
            {allocations.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted-foreground">
                  No {showHistory ? "" : "active "}allocations{search ? " match this search" : ""}.
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

export function AllocationSection(props: {
  allocations: AllocationRow[];
  totalCount: number;
  pageSize: number;
  showHistory: boolean;
  studentOptions: StudentOption[];
  availableBeds: AvailableBedOption[];
  canWrite: boolean;
}) {
  // useSearchParams (inside useServerTableParams) requires a Suspense
  // boundary -- same pattern balances-section.tsx/payments-section.tsx use.
  return (
    <Suspense fallback={null}>
      <AllocationSectionInner {...props} />
    </Suspense>
  );
}
