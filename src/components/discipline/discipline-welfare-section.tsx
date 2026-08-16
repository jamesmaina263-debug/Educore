"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/status-badge";
import {
  addDisciplinaryActionAction,
  createCaseAction,
  createIncidentAction,
  createSafeguardingReportAction,
  createWelfareConcernAction,
  updateCaseAction,
  updateSafeguardingReportAction,
  updateWelfareConcernAction,
} from "@/app/(app)/discipline/actions";

export interface StudentOption {
  id: string;
  name: string;
  admission_number: string;
}
export interface StaffOption {
  id: string;
  name: string;
}
export interface ActionType {
  id: string;
  name: string;
  category: string;
}
export interface IncidentRow {
  id: string;
  incident_date: string;
  incident_type: string | null;
  category: "minor" | "moderate" | "major";
  description: string;
  action_taken: string | null;
  location: string | null;
  visible_to_guardian: boolean;
  case_id: string | null;
  student: { id: string; name: string; admission_number: string };
}
export interface CaseRow {
  id: string;
  title: string;
  status: "open" | "investigating" | "pending_action" | "resolved" | "closed";
  investigation_notes: string | null;
  follow_up_notes: string | null;
  resolution: string | null;
  opened_at: string;
  closed_at: string | null;
  assigned_officer: string | null;
  student: { id: string; name: string; admission_number: string };
}
export interface WelfareRow {
  id: string;
  concern_type: string;
  description: string;
  status: "open" | "in_progress" | "resolved";
  counselling_referral: boolean;
  referred_to: string | null;
  follow_up_notes: string | null;
  created_at: string;
  student: { id: string; name: string; admission_number: string };
}
export interface SafeguardingRow {
  id: string;
  report_type: "concern" | "bullying" | "abuse" | "high_risk" | "other";
  description: string;
  status: "open" | "escalated" | "investigating" | "resolved" | "closed";
  escalated_to: string | null;
  follow_up_notes: string | null;
  created_at: string;
  student: { id: string; name: string; admission_number: string };
}

const CATEGORY_TONE: Record<IncidentRow["category"], "neutral" | "warning" | "danger"> = {
  minor: "neutral",
  moderate: "warning",
  major: "danger",
};
const CASE_STATUS_TONE: Record<CaseRow["status"], "neutral" | "warning" | "danger" | "success" | "info"> = {
  open: "info",
  investigating: "warning",
  pending_action: "warning",
  resolved: "success",
  closed: "neutral",
};
const WELFARE_STATUS_TONE: Record<WelfareRow["status"], "neutral" | "warning" | "success"> = {
  open: "warning",
  in_progress: "warning",
  resolved: "success",
};
const SAFEGUARDING_STATUS_TONE: Record<SafeguardingRow["status"], "neutral" | "warning" | "danger" | "success" | "info"> = {
  open: "danger",
  escalated: "danger",
  investigating: "warning",
  resolved: "success",
  closed: "neutral",
};

function StudentPicker({ students, name }: { students: StudentOption[]; name: string }) {
  return (
    <Select name={name} required>
      <SelectTrigger>
        <SelectValue placeholder="Select student" />
      </SelectTrigger>
      <SelectContent>
        {students.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name} ({s.admission_number})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DisciplineWelfareSection({
  section,
  permissions,
  students,
  staff,
  actionTypes,
  incidents,
  cases,
  welfare,
  safeguarding,
}: {
  section: "incidents" | "cases" | "welfare" | "safeguarding";
  permissions: {
    canReadAny: boolean;
    canWrite: boolean;
    canManageCases: boolean;
    canWelfareWrite: boolean;
    canWelfareReadAny: boolean;
    canSafeguardingRead: boolean;
    canSafeguardingWrite: boolean;
  };
  students: StudentOption[];
  staff: StaffOption[];
  actionTypes: ActionType[];
  incidents: IncidentRow[];
  cases: CaseRow[];
  welfare: WelfareRow[];
  safeguarding: SafeguardingRow[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [caseOpen, setCaseOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [welfareOpen, setWelfareOpen] = useState(false);
  const [safeguardingOpen, setSafeguardingOpen] = useState(false);

  const stats = useMemo(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentIncidents = incidents.filter((i) => new Date(i.incident_date) >= sevenDaysAgo).length;
    const openCases = cases.filter((c) => c.status !== "resolved" && c.status !== "closed").length;
    const pendingFollowUps =
      welfare.filter((w) => w.status !== "resolved").length +
      cases.filter((c) => (c.follow_up_notes?.trim().length ?? 0) > 0 && c.status !== "closed").length;
    const seriousCases = incidents.filter((i) => i.category === "major").length + safeguarding.length;
    return { recentIncidents, openCases, pendingFollowUps, seriousCases };
  }, [incidents, cases, welfare, safeguarding]);

  function runAction(fn: (fd: FormData) => Promise<{ error: string } | { success: true }>, formData: FormData, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn(formData);
      if ("error" in res) {
        setError(res.error);
      } else {
        onDone?.();
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-md border border-destructive/25 bg-destructive-subtle px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="panel px-4 py-3">
          <p className="label-eyebrow">Open Cases</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight" data-numeric>
            {stats.openCases}
          </p>
        </div>
        <div className="panel px-4 py-3">
          <p className="label-eyebrow">Incidents (7 days)</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight" data-numeric>
            {stats.recentIncidents}
          </p>
        </div>
        <div className="panel px-4 py-3">
          <p className="label-eyebrow">Pending Follow-ups</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight" data-numeric>
            {stats.pendingFollowUps}
          </p>
        </div>
        <div className="panel px-4 py-3">
          <p className="label-eyebrow">Needs Attention</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-destructive" data-numeric>
            {stats.seriousCases}
          </p>
        </div>
      </div>

      {/* ---------------- Incidents ---------------- */}
      {section === "incidents" && (
        <div className="flex flex-col gap-3">
          {permissions.canWrite && (
            <div className="flex justify-end">
              <Dialog open={incidentOpen} onOpenChange={setIncidentOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">Log Incident</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Log Incident</DialogTitle>
                  </DialogHeader>
                  <form
                    className="flex flex-col gap-3"
                    action={(fd) => runAction(createIncidentAction, fd, () => setIncidentOpen(false))}
                  >
                    <div className="flex flex-col gap-1.5">
                      <Label>Student</Label>
                      <StudentPicker students={students} name="student_id" />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <Label>Date</Label>
                        <Input type="date" name="incident_date" defaultValue={new Date().toISOString().slice(0, 10)} />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Severity</Label>
                        <Select name="category" defaultValue="minor" required>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="minor">Minor</SelectItem>
                            <SelectItem value="moderate">Moderate</SelectItem>
                            <SelectItem value="major">Major</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <Label>Type</Label>
                        <Input name="incident_type" placeholder="e.g. fighting, tardiness" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Location</Label>
                        <Input name="location" placeholder="e.g. playground" />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Description</Label>
                      <Textarea name="description" required />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Action taken (optional free text)</Label>
                      <Textarea name="action_taken" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox id="visible_to_guardian" name="visible_to_guardian" defaultChecked />
                      <Label htmlFor="visible_to_guardian">Visible to guardian</Label>
                    </div>
                    <DialogFooter>
                      <Button type="submit" disabled={isPending}>
                        Save
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          )}
          <div className="panel">
            <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <h2 className="text-[0.8125rem] font-semibold">Incidents · {incidents.length}</h2>
            </header>
            <div className="overflow-x-auto">
              <table className="table-dense w-full">
                <thead className="bg-muted/70">
                  <tr>
                    <th>Date</th>
                    <th>Student</th>
                    <th>Type</th>
                    <th>Severity</th>
                    <th>Description</th>
                    <th>Location</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center text-muted-foreground">
                        No incidents recorded yet.
                      </td>
                    </tr>
                  )}
                  {incidents.map((i) => (
                    <tr key={i.id}>
                      <td>{i.incident_date}</td>
                      <td className="font-medium">{i.student.name}</td>
                      <td className="text-muted-foreground">{i.incident_type ?? "—"}</td>
                      <td>
                        <StatusBadge tone={CATEGORY_TONE[i.category]} label={i.category} />
                      </td>
                      <td className="max-w-xs truncate">{i.description}</td>
                      <td className="text-muted-foreground">{i.location ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Cases ---------------- */}
      {section === "cases" && (
        <div className="flex flex-col gap-3">
          {permissions.canManageCases && (
            <div className="flex justify-end gap-2">
              <Dialog open={actionOpen} onOpenChange={setActionOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    Record Action
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Record Disciplinary Action</DialogTitle>
                  </DialogHeader>
                  <form
                    className="flex flex-col gap-3"
                    action={(fd) => runAction(addDisciplinaryActionAction, fd, () => setActionOpen(false))}
                  >
                    <div className="flex flex-col gap-1.5">
                      <Label>Student</Label>
                      <StudentPicker students={students} name="student_id" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Action Type</Label>
                      <Select name="action_type_id" required>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          {actionTypes.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <Label>Start date</Label>
                        <Input type="date" name="start_date" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>End date</Label>
                        <Input type="date" name="end_date" />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Notes</Label>
                      <Textarea name="description" />
                    </div>
                    <DialogFooter>
                      <Button type="submit" disabled={isPending}>
                        Save
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
              <Dialog open={caseOpen} onOpenChange={setCaseOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">Open Case</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Open Case</DialogTitle>
                  </DialogHeader>
                  <form className="flex flex-col gap-3" action={(fd) => runAction(createCaseAction, fd, () => setCaseOpen(false))}>
                    <div className="flex flex-col gap-1.5">
                      <Label>Student</Label>
                      <StudentPicker students={students} name="student_id" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Title</Label>
                      <Input name="title" required />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Assigned Officer</Label>
                      <Select name="assigned_officer">
                        <SelectTrigger>
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                        <SelectContent>
                          {staff.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <DialogFooter>
                      <Button type="submit" disabled={isPending}>
                        Save
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          )}
          <div className="flex flex-col gap-3">
            {cases.length === 0 && <p className="text-sm text-muted-foreground">No cases opened yet.</p>}
            {cases.map((c) => (
              <div key={c.id} className="rounded-md border border-border p-3">
                <div className="flex flex-row items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{c.title}</p>
                    <p className="text-sm text-muted-foreground">{c.student.name}</p>
                  </div>
                  <StatusBadge tone={CASE_STATUS_TONE[c.status]} label={c.status.replace("_", " ")} />
                </div>
                <div className="mt-2 flex flex-col gap-2 text-sm">
                  {c.investigation_notes && <p><span className="font-medium">Investigation: </span>{c.investigation_notes}</p>}
                  {c.follow_up_notes && <p><span className="font-medium">Follow-up: </span>{c.follow_up_notes}</p>}
                  {c.resolution && <p><span className="font-medium">Resolution: </span>{c.resolution}</p>}
                  {permissions.canManageCases && c.status !== "closed" && (
                    <form
                      className="flex flex-col gap-2 border-t border-border pt-2"
                      action={(fd) => runAction(updateCaseAction, fd)}
                    >
                      <input type="hidden" name="case_id" value={c.id} />
                      <div className="flex gap-2">
                        <Select name="status" defaultValue={c.status}>
                          <SelectTrigger className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="open">Open</SelectItem>
                            <SelectItem value="investigating">Investigating</SelectItem>
                            <SelectItem value="pending_action">Pending Action</SelectItem>
                            <SelectItem value="resolved">Resolved</SelectItem>
                            <SelectItem value="closed">Closed</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button type="submit" size="sm" variant="outline" disabled={isPending}>
                          Update
                        </Button>
                      </div>
                      <Textarea name="investigation_notes" placeholder="Investigation notes" defaultValue={c.investigation_notes ?? ""} />
                      <Textarea name="follow_up_notes" placeholder="Follow-up notes" defaultValue={c.follow_up_notes ?? ""} />
                      <Textarea name="resolution" placeholder="Resolution" defaultValue={c.resolution ?? ""} />
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------------- Welfare ---------------- */}
      {section === "welfare" && (
        <div className="flex flex-col gap-3">
          {permissions.canWelfareWrite && (
            <div className="flex justify-end">
              <Dialog open={welfareOpen} onOpenChange={setWelfareOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">Raise Concern</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Raise Welfare Concern</DialogTitle>
                  </DialogHeader>
                  <form
                    className="flex flex-col gap-3"
                    action={(fd) => runAction(createWelfareConcernAction, fd, () => setWelfareOpen(false))}
                  >
                    <div className="flex flex-col gap-1.5">
                      <Label>Student</Label>
                      <StudentPicker students={students} name="student_id" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Concern type</Label>
                      <Input name="concern_type" placeholder="e.g. emotional, social, family" required />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Description</Label>
                      <Textarea name="description" required />
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox id="counselling_referral" name="counselling_referral" />
                      <Label htmlFor="counselling_referral">Refer for counselling</Label>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Referred to (optional)</Label>
                      <Input name="referred_to" />
                    </div>
                    <DialogFooter>
                      <Button type="submit" disabled={isPending}>
                        Save
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          )}
          <div className="flex flex-col gap-3">
            {welfare.length === 0 && <p className="text-sm text-muted-foreground">No welfare concerns on record.</p>}
            {welfare.map((w) => (
              <div key={w.id} className="rounded-md border border-border p-3">
                <div className="flex flex-row items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{w.concern_type}</p>
                    <p className="text-sm text-muted-foreground">{w.student.name}</p>
                  </div>
                  <StatusBadge tone={WELFARE_STATUS_TONE[w.status]} label={w.status.replace("_", " ")} />
                </div>
                <div className="mt-2 flex flex-col gap-2 text-sm">
                  <p>{w.description}</p>
                  {w.counselling_referral && <p className="text-muted-foreground">Referred for counselling{w.referred_to ? ` — ${w.referred_to}` : ""}.</p>}
                  {w.follow_up_notes && <p><span className="font-medium">Follow-up: </span>{w.follow_up_notes}</p>}
                  {permissions.canWelfareReadAny && w.status !== "resolved" && (
                    <form className="flex gap-2 border-t border-border pt-2" action={(fd) => runAction(updateWelfareConcernAction, fd)}>
                      <input type="hidden" name="concern_id" value={w.id} />
                      <Select name="status" defaultValue={w.status}>
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Open</SelectItem>
                          <SelectItem value="in_progress">In Progress</SelectItem>
                          <SelectItem value="resolved">Resolved</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input name="follow_up_notes" placeholder="Follow-up notes" defaultValue={w.follow_up_notes ?? ""} className="flex-1" />
                      <Button type="submit" size="sm" variant="outline" disabled={isPending}>
                        Update
                      </Button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------------- Safeguarding ---------------- */}
      {section === "safeguarding" && permissions.canSafeguardingRead && (
        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-destructive/25 bg-destructive-subtle px-3 py-2 text-sm text-destructive">
              Restricted. Only visible to authorized safeguarding officers.
            </div>
            {permissions.canSafeguardingWrite && (
              <div className="flex justify-end">
                <Dialog open={safeguardingOpen} onOpenChange={setSafeguardingOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="destructive">
                      Report Concern
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Report Safeguarding Concern</DialogTitle>
                    </DialogHeader>
                    <form
                      className="flex flex-col gap-3"
                      action={(fd) => runAction(createSafeguardingReportAction, fd, () => setSafeguardingOpen(false))}
                    >
                      <div className="flex flex-col gap-1.5">
                        <Label>Student</Label>
                        <StudentPicker students={students} name="student_id" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Type</Label>
                        <Select name="report_type" required>
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="concern">Concern</SelectItem>
                            <SelectItem value="bullying">Bullying</SelectItem>
                            <SelectItem value="abuse">Abuse</SelectItem>
                            <SelectItem value="high_risk">High Risk</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Confidential notes</Label>
                        <Textarea name="description" required />
                      </div>
                      <DialogFooter>
                        <Button type="submit" disabled={isPending}>
                          Save
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            )}
            <div className="flex flex-col gap-3">
              {safeguarding.length === 0 && <p className="text-sm text-muted-foreground">No safeguarding reports on record.</p>}
              {safeguarding.map((s) => (
                <div key={s.id} className="rounded-md border border-destructive/25 p-3">
                  <div className="flex flex-row items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold capitalize">{s.report_type.replace("_", " ")}</p>
                      <p className="text-sm text-muted-foreground">{s.student.name}</p>
                    </div>
                    <StatusBadge tone={SAFEGUARDING_STATUS_TONE[s.status]} label={s.status} />
                  </div>
                  <div className="mt-2 flex flex-col gap-2 text-sm">
                    <p>{s.description}</p>
                    {s.follow_up_notes && <p><span className="font-medium">Follow-up: </span>{s.follow_up_notes}</p>}
                    {permissions.canSafeguardingWrite && s.status !== "closed" && (
                      <form className="flex flex-col gap-2 border-t pt-2" action={(fd) => runAction(updateSafeguardingReportAction, fd)}>
                        <input type="hidden" name="report_id" value={s.id} />
                        <div className="flex gap-2">
                          <Select name="status" defaultValue={s.status}>
                            <SelectTrigger className="w-40">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="open">Open</SelectItem>
                              <SelectItem value="escalated">Escalated</SelectItem>
                              <SelectItem value="investigating">Investigating</SelectItem>
                              <SelectItem value="resolved">Resolved</SelectItem>
                              <SelectItem value="closed">Closed</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select name="escalated_to">
                            <SelectTrigger className="w-48">
                              <SelectValue placeholder="Escalate to..." />
                            </SelectTrigger>
                            <SelectContent>
                              {staff.map((st) => (
                                <SelectItem key={st.id} value={st.id}>
                                  {st.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button type="submit" size="sm" variant="outline" disabled={isPending}>
                            Update
                          </Button>
                        </div>
                        <Textarea name="follow_up_notes" placeholder="Follow-up notes" defaultValue={s.follow_up_notes ?? ""} />
                      </form>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
    </div>
  );
}
