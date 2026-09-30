"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { logEmergency } from "@/app/(app)/health/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { StudentCombobox } from "@/components/shared/student-combobox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useServerTableParams } from "@/hooks/use-server-table-params";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { queueMutation } from "@/lib/offline/queue";
import { HealthOfflineBanner } from "./offline-banner";
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

/**
 * `emergencies` arrives already paginated/searched server-side (see
 * getEmergenciesPage) -- same useServerTableParams pattern used elsewhere
 * in this module. Doesn't touch loadHealthContext.
 */
function EmergenciesSectionInner({
  emergencies,
  totalCount,
  pageSize,
  studentOptions,
  canWrite,
}: {
  emergencies: EmergencyRow[];
  totalCount: number;
  pageSize: number;
  studentOptions: StudentOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const { pageIndex, pageCount, onPageChange, search, onSearchChange } = useServerTableParams({
    totalCount,
    pageSize,
  });
  const page = pageIndex + 1;
  const { online, pendingCount, failed, syncing, sync, discard } = useOfflineSync("health");
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
    // Generated once here so a queued-then-replayed retry (lost ack after the original
    // request actually landed) reuses the same key instead of creating a second
    // emergency record for the same incident -- same pattern as medication-section.tsx.
    const clientMutationId = crypto.randomUUID();
    const input = {
      ...form,
      action_taken: form.action_taken || undefined,
      hospital_name: form.hospital_name || undefined,
      client_mutation_id: clientMutationId,
    };
    if (!online) {
      await queueMutation("health", "logEmergency", input);
      setPending(false);
      setOpen(false);
      setForm({ student_id: "", description: "", severity: "moderate", action_taken: "", hospital_name: "", guardian_notified: false });
      return;
    }
    const result = await logEmergency(input);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setForm({ student_id: "", description: "", severity: "moderate", action_taken: "", hospital_name: "", guardian_notified: false });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <HealthOfflineBanner online={online} pendingCount={pendingCount} failed={failed} syncing={syncing} sync={sync} discard={discard} />
      <div className="flex flex-wrap items-center justify-between gap-3">
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
              <StudentCombobox
                students={studentOptions}
                value={form.student_id}
                onChange={(v) => setForm({ ...form, student_id: v })}
                placeholder="Student"
              />
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
                  {search ? "No emergencies match this search." : "No emergencies on record."}
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

export function EmergenciesSection(props: {
  emergencies: EmergencyRow[];
  totalCount: number;
  pageSize: number;
  studentOptions: StudentOption[];
  canWrite: boolean;
}) {
  return (
    <Suspense fallback={null}>
      <EmergenciesSectionInner {...props} />
    </Suspense>
  );
}
