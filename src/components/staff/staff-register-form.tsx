"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { submitStaffAttendance, editStaffAttendanceRecord } from "@/app/staff/actions";

export interface StaffRosterRow {
  staff_id: string;
  full_name: string;
  role_name: string;
  existing: { record_id: string; status: Mark } | null;
}

type Mark = "present" | "absent" | "late" | "on_leave" | "half_day";

const STATUS_OPTIONS: { value: Mark; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "late", label: "Late" },
  { value: "on_leave", label: "On leave" },
  { value: "half_day", label: "Half day" },
];

function statusTone(status: Mark) {
  if (status === "present") return "success";
  if (status === "late" || status === "half_day") return "warning";
  return "danger";
}

export function StaffRegisterForm({
  attendanceDate,
  roster,
  canMark,
}: {
  attendanceDate: string;
  roster: StaffRosterRow[];
  canMark: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, Mark>>(
    Object.fromEntries(roster.filter((r) => !r.existing).map((r) => [r.staff_id, "present" as Mark])),
  );
  const [editTarget, setEditTarget] = useState<StaffRosterRow | null>(null);
  const [editStatus, setEditStatus] = useState<Mark>("present");
  const [editReason, setEditReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const unmarked = roster.filter((r) => !r.existing);
  const marked = roster.filter((r) => r.existing);

  async function handleSubmit() {
    setPending(true);
    setError(null);
    const result = await submitStaffAttendance({
      attendance_date: attendanceDate,
      marks: unmarked.map((r) => ({ staff_id: r.staff_id, status: draft[r.staff_id] ?? "present" })),
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function handleEditSave() {
    if (!editTarget?.existing) return;
    setPending(true);
    setError(null);
    const result = await editStaffAttendanceRecord(editTarget.existing.record_id, editStatus, editReason);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setEditTarget(null);
    setEditReason("");
    router.refresh();
  }

  const presentCount = marked.filter((r) => r.existing!.status === "present").length;
  const absentCount = marked.filter((r) => r.existing!.status === "absent").length;
  const otherCount = marked.length - presentCount - absentCount;

  if (roster.length === 0) {
    return (
      <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
        No active staff found.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      {unmarked.length > 0 && (
        <div className="panel">
          <header className="border-b border-border px-4 py-2.5">
            <h2 className="text-[0.8125rem] font-semibold">To mark · {unmarked.length} staff</h2>
          </header>
          {canMark ? (
            <>
              <div className="overflow-x-auto">
                <table className="table-dense w-full">
                  <thead className="bg-muted/70">
                    <tr>
                      <th>Staff</th>
                      <th>Role</th>
                      <th>Mark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unmarked.map((r) => (
                      <tr key={r.staff_id}>
                        <td className="font-medium">{r.full_name}</td>
                        <td className="text-muted-foreground">{r.role_name}</td>
                        <td>
                          <div className="flex flex-wrap gap-1.5">
                            {STATUS_OPTIONS.map((opt) => (
                              <Button
                                key={opt.value}
                                size="sm"
                                variant={draft[r.staff_id] === opt.value ? "default" : "outline"}
                                onClick={() => setDraft((d) => ({ ...d, [r.staff_id]: opt.value }))}
                              >
                                {opt.label}
                              </Button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end border-t border-border px-4 py-2.5">
                <Button onClick={handleSubmit} disabled={pending}>
                  {pending ? "Submitting…" : `Submit register (${unmarked.length} staff)`}
                </Button>
              </div>
            </>
          ) : (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              Not yet marked. You don&apos;t have permission to mark it.
            </p>
          )}
        </div>
      )}

      {marked.length > 0 && (
        <div className="panel">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <h2 className="text-[0.8125rem] font-semibold">Already marked · {marked.length} staff</h2>
            <div className="flex items-center gap-2">
              <StatusBadge tone="success" label={`${presentCount} present`} />
              <StatusBadge tone="danger" label={`${absentCount} absent`} />
              {otherCount > 0 && <StatusBadge tone="warning" label={`${otherCount} other`} />}
            </div>
          </header>
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th>Staff</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {marked.map((r) => (
                  <tr key={r.staff_id}>
                    <td className="font-medium">{r.full_name}</td>
                    <td className="text-muted-foreground">{r.role_name}</td>
                    <td>
                      <StatusBadge tone={statusTone(r.existing!.status)} label={r.existing!.status.replace("_", " ")} />
                    </td>
                    <td>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={editTarget !== null} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Correct attendance — {editTarget?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
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
