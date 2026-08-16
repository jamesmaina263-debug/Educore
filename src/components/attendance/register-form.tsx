"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Minus, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { submitAttendance, editAttendanceRecord } from "@/app/(app)/attendance/actions";

export interface RosterRow {
  student_id: string;
  admission_number: string;
  full_name: string;
  term_attendance_rate: number | null;
  existing: { record_id: string; status: "present" | "absent" | "late" } | null;
}

type Mark = "present" | "absent" | "late";

const marks: { key: Mark; label: string; icon: typeof Check }[] = [
  { key: "present", label: "Present", icon: Check },
  { key: "absent", label: "Absent", icon: X },
  { key: "late", label: "Late", icon: Minus },
];

function statusTone(status: Mark) {
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
  const presentCount = marked.filter((r) => r.existing!.status === "present").length;
  const absentCount = marked.filter((r) => r.existing!.status === "absent").length;
  const lateCount = marked.filter((r) => r.existing!.status === "late").length;

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

  function handleMarkAllPresent() {
    setDraft(Object.fromEntries(unmarked.map((r) => [r.student_id, "present" as Mark])));
  }

  function handleMarkClick(row: RosterRow, mark: Mark) {
    if (!canMark) return;
    if (!row.existing) {
      setDraft((d) => ({ ...d, [row.student_id]: mark }));
      return;
    }
    if (row.existing.status === mark) return;
    setEditTarget(row);
    setEditStatus(mark);
    setEditReason("");
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
      <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
        No active students in this class.
      </div>
    );
  }

  return (
    <>
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="panel">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Class roll · {roster.length} learners</h2>
          <div className="flex flex-wrap items-center gap-3">
            {marked.length > 0 && (
              <div className="flex items-center gap-2 text-[0.6875rem] text-muted-foreground">
                <StatusBadge tone="success" label={`${presentCount} present`} />
                <StatusBadge tone="danger" label={`${absentCount} absent`} />
                <StatusBadge tone="warning" label={`${lateCount} late`} />
              </div>
            )}
            {canMark && unmarked.length > 0 && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleMarkAllPresent}>
                  Mark all present
                </Button>
                <Button size="sm" onClick={handleSubmit} disabled={pending}>
                  <Save className="size-4" aria-hidden /> {pending ? "Submitting…" : `Submit register (${unmarked.length})`}
                </Button>
              </div>
            )}
          </div>
        </header>
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead className="bg-muted/70">
              <tr>
                <th className="w-10">#</th>
                <th>Adm. no.</th>
                <th>Student</th>
                <th className="text-right">Term attendance</th>
                <th className="w-56">Mark</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((r, i) => {
                const currentMark = r.existing?.status ?? draft[r.student_id];
                return (
                  <tr key={r.student_id}>
                    <td className="text-muted-foreground">{i + 1}</td>
                    <td className="font-mono text-[0.75rem] text-muted-foreground">{r.admission_number}</td>
                    <td className="font-medium">{r.full_name}</td>
                    <td className="text-right" data-numeric>
                      {r.term_attendance_rate === null ? (
                        "—"
                      ) : r.term_attendance_rate < 80 ? (
                        <StatusBadge tone="danger" label={`${r.term_attendance_rate}%`} />
                      ) : r.term_attendance_rate < 90 ? (
                        <StatusBadge tone="warning" label={`${r.term_attendance_rate}%`} />
                      ) : (
                        `${r.term_attendance_rate}%`
                      )}
                    </td>
                    <td>
                      <div
                        role="group"
                        aria-label={`Attendance mark for ${r.full_name}`}
                        className="inline-flex overflow-hidden rounded-md border border-input"
                      >
                        {marks.map((m) => {
                          const active = currentMark === m.key;
                          return (
                            <button
                              key={m.key}
                              type="button"
                              disabled={!canMark}
                              onClick={() => handleMarkClick(r, m.key)}
                              className={
                                "inline-flex h-6 items-center gap-1 border-r border-input px-2 text-[0.6875rem] font-medium last:border-r-0 hover:bg-accent hover:text-accent-foreground focus-visible:relative disabled:cursor-not-allowed disabled:opacity-50 " +
                                (active ? "bg-accent text-accent-foreground" : "text-muted-foreground")
                              }
                            >
                              <m.icon className="size-3" aria-hidden />
                              {m.label}
                            </button>
                          );
                        })}
                      </div>
                      {r.existing && (
                        <p className="mt-1 text-[0.625rem] text-muted-foreground">Submitted — pick a different mark to correct</p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={editTarget !== null} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Correct attendance — {editTarget?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-1.5">
              {marks.map((m) => (
                <Button
                  key={m.key}
                  size="sm"
                  variant={editStatus === m.key ? "default" : "outline"}
                  onClick={() => setEditStatus(m.key)}
                >
                  <m.icon className="size-3.5" aria-hidden /> {m.label}
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
    </>
  );
}
