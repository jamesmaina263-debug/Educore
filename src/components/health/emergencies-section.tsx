"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { logEmergency } from "@/app/(app)/health/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import type { StudentOption } from "./student-picker";

export interface EmergencyRow {
  id: string;
  student_name: string;
  incident_at: string;
  description: string;
  severity: "moderate" | "severe" | "critical";
  action_taken: string | null;
  hospital_name: string | null;
  guardian_notified: boolean;
}

const severityTone: Record<EmergencyRow["severity"], "warning" | "danger"> = {
  moderate: "warning",
  severe: "danger",
  critical: "danger",
};

export function EmergenciesSection({
  emergencies,
  studentOptions,
  canWrite,
}: {
  emergencies: EmergencyRow[];
  studentOptions: StudentOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    student_id: "",
    description: "",
    severity: "moderate" as EmergencyRow["severity"],
    action_taken: "",
    hospital_name: "",
    guardian_notified: false,
  });

  async function submit() {
    if (!form.student_id || !form.description) {
      setError("Student and description are required.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await logEmergency({
      ...form,
      action_taken: form.action_taken || undefined,
      hospital_name: form.hospital_name || undefined,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setForm({ student_id: "", description: "", severity: "moderate", action_taken: "", hospital_name: "", guardian_notified: false });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {canWrite && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="destructive" className="self-start">
              Log emergency
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Log a medical emergency</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Select value={form.student_id} onValueChange={(v) => setForm({ ...form, student_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Student" />
                </SelectTrigger>
                <SelectContent>
                  {studentOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={form.severity} onValueChange={(v: EmergencyRow["severity"]) => setForm({ ...form, severity: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="moderate">Moderate</SelectItem>
                  <SelectItem value="severe">Severe</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
              <Textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <Textarea placeholder="Action taken (optional)" value={form.action_taken} onChange={(e) => setForm({ ...form, action_taken: e.target.value })} />
              <Input placeholder="Hospital name (if applicable)" value={form.hospital_name} onChange={(e) => setForm({ ...form, hospital_name: e.target.value })} />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.guardian_notified}
                  onChange={(e) => setForm({ ...form, guardian_notified: e.target.checked })}
                  className="size-4 rounded-sm border-border"
                />
                Guardian notified
              </label>
              {error && <p className="text-sm text-danger">{error}</p>}
            </div>
            <DialogFooter>
              <Button onClick={submit} disabled={pending} variant="destructive">
                {pending ? "Logging…" : "Log emergency"}
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
              <th className="text-left">When</th>
              <th className="text-left">Severity</th>
              <th className="text-left">Description</th>
              <th className="text-left">Guardian notified</th>
            </tr>
          </thead>
          <tbody>
            {emergencies.map((e) => (
              <tr key={e.id}>
                <td>{e.student_name}</td>
                <td>{new Date(e.incident_at).toLocaleString()}</td>
                <td>
                  <StatusBadge tone={severityTone[e.severity]} label={e.severity} />
                </td>
                <td className="max-w-xs truncate text-muted-foreground" title={e.description}>
                  {e.description}
                </td>
                <td>{e.guardian_notified ? "Yes" : "No"}</td>
              </tr>
            ))}
            {emergencies.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-muted-foreground">
                  No emergencies on record.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
