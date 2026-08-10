"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { logIncident, updateIncidentStatus } from "@/app/boarding/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { StudentOption } from "./allocation-section";

export interface IncidentRow {
  id: string;
  student_name: string;
  incident_type: string;
  incident_date: string;
  location: string | null;
  description: string;
  staff_name: string | null;
  action_taken: string | null;
  follow_up: string | null;
  status: "open" | "closed";
}

const INCIDENT_TYPES = ["Bullying", "Property damage", "Curfew violation", "Health emergency", "Fighting", "Other"];

export function IncidentsSection({
  incidents,
  boardingStudents,
  canWrite,
}: {
  incidents: IncidentRow[];
  boardingStudents: StudentOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    student_id: "",
    incident_type: INCIDENT_TYPES[0],
    location: "",
    description: "",
    action_taken: "",
    follow_up: "",
  });

  async function submit() {
    if (!form.student_id || !form.description.trim()) {
      setError("Student and description are required.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await logIncident({
      student_id: form.student_id,
      incident_type: form.incident_type,
      location: form.location || undefined,
      description: form.description,
      action_taken: form.action_taken || undefined,
      follow_up: form.follow_up || undefined,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setForm({ student_id: "", incident_type: INCIDENT_TYPES[0], location: "", description: "", action_taken: "", follow_up: "" });
    router.refresh();
  }

  async function toggleStatus(incident: IncidentRow) {
    setPending(true);
    await updateIncidentStatus(incident.id, incident.status === "open" ? "closed" : "open");
    setPending(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {canWrite && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="self-start">
              Log incident
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Log a boarding incident</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Select value={form.student_id} onValueChange={(v) => setForm({ ...form, student_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Student" />
                </SelectTrigger>
                <SelectContent>
                  {boardingStudents.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={form.incident_type} onValueChange={(v) => setForm({ ...form, incident_type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INCIDENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input placeholder="Location (optional)" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Action taken (optional)</Label>
                <Textarea value={form.action_taken} onChange={(e) => setForm({ ...form, action_taken: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Follow-up (optional)</Label>
                <Textarea value={form.follow_up} onChange={(e) => setForm({ ...form, follow_up: e.target.value })} />
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}
            </div>
            <DialogFooter>
              <Button onClick={submit} disabled={pending}>
                {pending ? "Logging…" : "Log incident"}
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
              <th className="text-left">Type</th>
              <th className="text-left">Date</th>
              <th className="text-left">Description</th>
              <th className="text-left">Status</th>
              {canWrite && <th />}
            </tr>
          </thead>
          <tbody>
            {incidents.map((i) => (
              <tr key={i.id}>
                <td>{i.student_name}</td>
                <td>{i.incident_type}</td>
                <td>{new Date(i.incident_date).toLocaleDateString()}</td>
                <td className="max-w-xs truncate text-muted-foreground" title={i.description}>
                  {i.description}
                </td>
                <td>
                  <StatusBadge tone={i.status === "open" ? "danger" : "success"} label={i.status} />
                </td>
                {canWrite && (
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => toggleStatus(i)} disabled={pending}>
                      {i.status === "open" ? "Close" : "Reopen"}
                    </Button>
                  </td>
                )}
              </tr>
            ))}
            {incidents.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted-foreground">
                  No incidents on record.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
