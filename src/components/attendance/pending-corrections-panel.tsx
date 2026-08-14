"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { reviewAttendanceCorrection } from "@/app/attendance/actions";

export interface PendingCorrectionRow {
  id: string;
  student_name: string;
  attendance_date: string;
  requested_status: string;
  correction_reason: string;
  requested_by_name: string | null;
}

export function PendingCorrectionsPanel({ corrections }: { corrections: PendingCorrectionRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function handleReview(id: string, decision: "approved" | "rejected") {
    setPending(id);
    await reviewAttendanceCorrection(id, decision);
    setPending(null);
    router.refresh();
  }

  if (corrections.length === 0) return null;

  return (
    <div className="panel">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-[0.8125rem] font-semibold">Corrections Awaiting Review</h2>
        <StatusBadge tone="warning" label={`${corrections.length} pending`} />
      </header>
      <div className="overflow-x-auto">
        <table className="table-dense w-full">
          <thead className="bg-muted/70">
            <tr>
              <th>Student</th>
              <th>Date</th>
              <th>Corrected to</th>
              <th>Reason</th>
              <th>By</th>
              <th className="text-right">Review</th>
            </tr>
          </thead>
          <tbody>
            {corrections.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.student_name}</td>
                <td className="text-muted-foreground">{c.attendance_date}</td>
                <td className="text-muted-foreground">{c.requested_status}</td>
                <td className="max-w-xs truncate text-muted-foreground">{c.correction_reason}</td>
                <td className="text-muted-foreground">{c.requested_by_name ?? "—"}</td>
                <td className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" disabled={pending === c.id} onClick={() => handleReview(c.id, "approved")}>
                      Approve
                    </Button>
                    <Button size="sm" variant="ghost" disabled={pending === c.id} onClick={() => handleReview(c.id, "rejected")}>
                      Reject
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
