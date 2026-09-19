"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { logIncident, updateIncidentStatus } from "@/app/(app)/boarding/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { StudentCombobox } from "@/components/shared/student-combobox";
import { useServerTableParams } from "@/hooks/use-server-table-params";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { queueMutation } from "@/lib/offline/queue";
import { BoardingOfflineBanner } from "./offline-banner";
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

/**
 * `incidents` arrives already paginated/searched server-side (see
 * getIncidentsPage) -- same useServerTableParams pattern as
 * allocation-section.tsx/transfers-section.tsx. Doesn't touch
 * loadBoardingContext or the offline-queue sync path.
 */
function IncidentsSectionInner({
  incidents,
  totalCount,
  pageSize,
  boardingStudents,
  canWrite,
}: {
  incidents: IncidentRow[];
  totalCount: number;
  pageSize: number;
  boardingStudents: StudentOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const { pageIndex, pageCount, onPageChange, search, onSearchChange } = useServerTableParams({
    totalCount,
    pageSize,
  });
  const page = pageIndex + 1;
  const { online, pendingCount, failed, syncing, sync, discard } = useOfflineSync("boarding");
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
    const input = {
      student_id: form.student_id,
      incident_type: form.incident_type,
      location: form.location || undefined,
      description: form.description,
      action_taken: form.action_taken || undefined,
      follow_up: form.follow_up || undefined,
    };
    if (!online) {
      await queueMutation("boarding", "logIncident", input);
      setPending(false);
      setOpen(false);
      setForm({ student_id: "", incident_type: INCIDENT_TYPES[0], location: "", description: "", action_taken: "", follow_up: "" });
      return;
    }
    const result = await logIncident(input);
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
      <BoardingOfflineBanner online={online} pendingCount={pendingCount} failed={failed} syncing={syncing} sync={sync} discard={discard} />
      <div className="flex flex-wrap items-center justify-between gap-3">
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
              <StudentCombobox
                students={boardingStudents}
                value={form.student_id}
                onChange={(v) => setForm({ ...form, student_id: v })}
                placeholder="Student"
              />
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
                  No incidents {search ? "match this search" : "on record"}.
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

export function IncidentsSection(props: {
  incidents: IncidentRow[];
  totalCount: number;
  pageSize: number;
  boardingStudents: StudentOption[];
  canWrite: boolean;
}) {
  return (
    <Suspense fallback={null}>
      <IncidentsSectionInner {...props} />
    </Suspense>
  );
}
