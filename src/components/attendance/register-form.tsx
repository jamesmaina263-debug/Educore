"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { submitAttendance, editAttendanceRecord } from "@/app/attendance/actions";

export interface RosterRow {
  student_id: string;
  full_name: string;
  existing: { record_id: string; status: "present" | "absent" | "late" } | null;
}

type Mark = "present" | "absent" | "late";

const STATUS_OPTIONS: { value: Mark; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "late", label: "Late" },
];

function badgeVariant(status: Mark) {
  return status === "present" ? "success" : status === "late" ? "warning" : "danger";
}

export function RegisterForm({
  streamId,
  attendanceDate,
  roster,
  canMark,
}: {
  streamId: string;
  attendanceDate: string;
  roster: RosterRow[];
  canMark: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, Mark>>(
    Object.fromEntries(roster.filter((r) => !r.existing).map((r) => [r.student_id, "present" as Mark])),
  );
  const [editTarget, setEditTarget] = useState<RosterRow | null>(null);
  const [editStatus, setEditStatus] = useState<Mark>("present");
  const [editReason, setEditReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const unmarked = roster.filter((r) => !r.existing);
  const marked = roster.filter((r) => r.existing);

  async function handleSubmit() {
    setPending(true);
    setError(null);
    const result = await submitAttendance({
      stream_id: streamId,
      attendance_date: attendanceDate,
      marks: unmarked.map((r) => ({ student_id: r.student_id, status: draft[r.student_id] ?? "present" })),
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function handleEditSave() {
    if (!editTarget?.existing) return;
    setPending(true);
    setError(null);
    const result = await editAttendanceRecord(editTarget.existing.record_id, editStatus, editReason);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setEditTarget(null);
    setEditReason("");
    router.refresh();
  }

  if (roster.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        No active students in this class.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      {unmarked.length > 0 && (
        <div>
          {canMark ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Mark</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unmarked.map((r) => (
                    <TableRow key={r.student_id}>
                      <TableCell className="font-medium">{r.full_name}</TableCell>
                      <TableCell>
                        <div className="flex gap-1.5">
                          {STATUS_OPTIONS.map((opt) => (
                            <Button
                              key={opt.value}
                              size="sm"
                              variant={draft[r.student_id] === opt.value ? "default" : "outline"}
                              onClick={() => setDraft((d) => ({ ...d, [r.student_id]: opt.value }))}
                            >
                              {opt.label}
                            </Button>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-3 flex justify-end">
                <Button onClick={handleSubmit} disabled={pending}>
                  {pending ? "Submitting…" : `Submit register (${unmarked.length} students)`}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Not yet marked. You don&apos;t have permission to mark it.</p>
          )}
        </div>
      )}

      {marked.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium">Already marked</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {marked.map((r) => (
                <TableRow key={r.student_id}>
                  <TableCell className="font-medium">{r.full_name}</TableCell>
                  <TableCell>
                    <Badge dot variant={badgeVariant(r.existing!.status)}>
                      {r.existing!.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {canMark && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditTarget(r);
                          setEditStatus(r.existing!.status);
                          setEditReason("");
                        }}
                      >
                        Correct
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={editTarget !== null} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Correct attendance — {editTarget?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-1.5">
              {STATUS_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  size="sm"
                  variant={editStatus === opt.value ? "default" : "outline"}
                  onClick={() => setEditStatus(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">Reason for the correction (required)</p>
              <Textarea value={editReason} onChange={(e) => setEditReason(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleEditSave} disabled={pending || !editReason.trim()}>
              {pending ? "Saving…" : "Save correction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
