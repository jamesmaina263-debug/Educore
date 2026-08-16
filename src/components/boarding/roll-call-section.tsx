"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitRollCall } from "@/app/(app)/boarding/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export interface BoardingStudentRow {
  student_id: string;
  stream_id: string;
  name: string;
  bed_label: string;
  existing_status: RollCallStatus | null;
}

type RollCallStatus = "present" | "absent" | "sick_bay" | "excused" | "late";

const STATUS_OPTIONS: { value: RollCallStatus; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "sick_bay", label: "Sick bay" },
  { value: "excused", label: "Excused" },
  { value: "late", label: "Late" },
];

export function RollCallSection({
  date,
  session,
  students,
  canWrite,
}: {
  date: string;
  session: "boarding_am" | "boarding_pm";
  students: BoardingStudentRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [statuses, setStatuses] = useState<Record<string, RollCallStatus>>(
    Object.fromEntries(students.map((s) => [s.student_id, s.existing_status ?? "present"])),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function changeDate(newDate: string) {
    router.push(`/boarding/roll-call?date=${newDate}&session=${session}`);
  }

  function changeSession(newSession: string) {
    router.push(`/boarding/roll-call?date=${date}&session=${newSession}`);
  }

  function markAllPresent() {
    setStatuses(Object.fromEntries(students.map((s) => [s.student_id, "present" as RollCallStatus])));
  }

  async function save() {
    setPending(true);
    setError(null);
    setSaved(false);
    const entries = students.map((s) => ({
      student_id: s.student_id,
      stream_id: s.stream_id,
      status: statuses[s.student_id] ?? "present",
    }));
    const result = await submitRollCall(date, session, entries);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input type="date" value={date} onChange={(e) => changeDate(e.target.value)} className="w-40" />
        <Select value={session} onValueChange={changeSession}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="boarding_am">Morning</SelectItem>
            <SelectItem value="boarding_pm">Evening</SelectItem>
          </SelectContent>
        </Select>
        {canWrite && (
          <Button size="sm" variant="outline" onClick={markAllPresent}>
            Mark all present
          </Button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="table-dense w-full">
          <thead>
            <tr>
              <th className="text-left">Student</th>
              <th className="text-left">Bed</th>
              <th className="text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.student_id}>
                <td>{s.name}</td>
                <td className="text-muted-foreground">{s.bed_label}</td>
                <td>
                  {canWrite ? (
                    <Select
                      value={statuses[s.student_id] ?? "present"}
                      onValueChange={(v: RollCallStatus) => setStatuses({ ...statuses, [s.student_id]: v })}
                    >
                      <SelectTrigger className="h-8 w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    STATUS_OPTIONS.find((o) => o.value === statuses[s.student_id])?.label
                  )}
                </td>
              </tr>
            ))}
            {students.length === 0 && (
              <tr>
                <td colSpan={3} className="py-6 text-center text-muted-foreground">
                  No boarding students to roll-call.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {canWrite && students.length > 0 && (
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save roll call"}
          </Button>
          {saved && <span className="text-sm text-success">Saved.</span>}
        </div>
      )}
    </div>
  );
}
