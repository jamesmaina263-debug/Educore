"use client";

import { Fragment, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { LeadFormDialog, LostReasonDialog, type RepOption } from "@/components/admin/sales-lead-dialogs";
import {
  addSalesLeadActivity,
  deleteSalesLead,
  setSalesLeadStage,
} from "@/app/(admin)/admin/sales-pipeline/actions";
import { downloadCsvFromObjectRows } from "@/lib/csv-export";
import {
  ACTIVITY_TYPES,
  STAGES,
  activityLabel,
  formatDateOnly,
  formatInstantNairobi,
  funnelCounts,
  isFollowUpOverdue,
  isFollowUpToday,
  leadsToCsvRows,
  sourceLabel,
  stageLabel,
  stageTone,
  weeklyActivityByRep,
  type ActivityType,
  type SalesActivityRow,
  type SalesLeadRow,
} from "@/lib/sales/pipeline";

// --- "Working as" ---------------------------------------------------------------------------
// The console login can be shared between reps, so "who did this" can't come from the session.
// Each rep picks their name once; it is remembered in this browser and stamped on every stage
// change and activity they log. useSyncExternalStore keeps server and client renders identical
// (server snapshot is always "") so there is no hydration mismatch.

const WORKING_AS_KEY = "educore.salesPipeline.workingAs";
const WORKING_AS_EVENT = "educore:sales-working-as";

function subscribeWorkingAs(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(WORKING_AS_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(WORKING_AS_EVENT, callback);
  };
}

function readWorkingAs(): string {
  try {
    return window.localStorage.getItem(WORKING_AS_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeWorkingAs(id: string) {
  try {
    if (id) window.localStorage.setItem(WORKING_AS_KEY, id);
    else window.localStorage.removeItem(WORKING_AS_KEY);
  } catch {
    // Private mode / storage disabled: the selection just won't be remembered.
  }
  window.dispatchEvent(new Event(WORKING_AS_EVENT));
}

const ALL = "__all__";
const UNASSIGNED = "__unassigned__";
const NEED_WORKING_AS = "Choose who you are working as (top right of this page) before logging changes.";

export function AdminSalesPipeline({
  leads,
  activities,
  reps,
  today,
  weekStartIso,
}: {
  leads: SalesLeadRow[];
  activities: SalesActivityRow[];
  reps: RepOption[];
  today: string;
  weekStartIso: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [stageFilter, setStageFilter] = useState<string>(ALL);
  const [repFilter, setRepFilter] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [formLead, setFormLead] = useState<SalesLeadRow | null | undefined>(undefined); // undefined = closed, null = new
  const [lostTarget, setLostTarget] = useState<SalesLeadRow | null>(null);
  const [lostError, setLostError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SalesLeadRow | null>(null);

  const workingAs = useSyncExternalStore(subscribeWorkingAs, readWorkingAs, () => "");
  const validWorkingAs = reps.some((r) => r.id === workingAs) ? workingAs : "";

  const repNameById = useMemo(() => new Map(reps.map((r) => [r.id, r.name])), [reps]);

  const activitiesByLead = useMemo(() => {
    const map = new Map<string, SalesActivityRow[]>();
    for (const a of activities) {
      const list = map.get(a.lead_id);
      if (list) list.push(a);
      else map.set(a.lead_id, [a]);
    }
    return map; // activities arrive newest-first, so each list is newest-first too
  }, [activities]);

  const counts = useMemo(() => funnelCounts(leads), [leads]);
  const overdueCount = useMemo(
    () => leads.filter((l) => isFollowUpOverdue(l.next_follow_up_on, l.stage, today)).length,
    [leads, today],
  );
  const dueTodayCount = useMemo(
    () => leads.filter((l) => isFollowUpToday(l.next_follow_up_on, l.stage, today)).length,
    [leads, today],
  );
  const weekSummary = useMemo(() => weeklyActivityByRep(activities, weekStartIso), [activities, weekStartIso]);

  const visibleLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rank = (l: SalesLeadRow) =>
      isFollowUpOverdue(l.next_follow_up_on, l.stage, today) ? 0 : isFollowUpToday(l.next_follow_up_on, l.stage, today) ? 1 : 2;
    return leads
      .filter((l) => (stageFilter === ALL ? true : l.stage === stageFilter))
      .filter((l) => {
        if (repFilter === ALL) return true;
        if (repFilter === UNASSIGNED) return l.assigned_to === null;
        return l.assigned_to === repFilter;
      })
      .filter((l) => (overdueOnly ? isFollowUpOverdue(l.next_follow_up_on, l.stage, today) : true))
      .filter((l) => {
        if (!q) return true;
        return [l.school_name, l.town_county, l.contact_name, l.phone, l.current_system]
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(q));
      })
      .sort((a, b) => rank(a) - rank(b) || b.updated_at.localeCompare(a.updated_at));
  }, [leads, stageFilter, repFilter, overdueOnly, search, today]);

  function run(fn: () => Promise<{ error: string } | { success: true }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  function handleStageChange(lead: SalesLeadRow, stage: string) {
    if (stage === lead.stage) return;
    if (!validWorkingAs) {
      setError(NEED_WORKING_AS);
      return;
    }
    if (stage === "lost") {
      setLostError(null);
      setLostTarget(lead);
      return;
    }
    run(() => setSalesLeadStage(lead.id, stage, null, validWorkingAs));
  }

  function handleConfirmLost(reason: string) {
    if (!lostTarget) return;
    setLostError(null);
    startTransition(async () => {
      const res = await setSalesLeadStage(lostTarget.id, "lost", reason, validWorkingAs || null);
      if ("error" in res) setLostError(res.error);
      else {
        setLostTarget(null);
        router.refresh();
      }
    });
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteSalesLead(deleteTarget.id);
      if ("error" in res) setError(res.error);
      else {
        setDeleteTarget(null);
        setExpanded(null);
        router.refresh();
      }
    });
  }

  async function handleExport() {
    setError(null);
    try {
      await downloadCsvFromObjectRows(leadsToCsvRows(visibleLeads, repNameById), `educore-sales-pipeline-${today}.csv`);
    } catch {
      setError("Could not build the CSV file. Try again.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Who is working -- attribution for a shared login */}
      <div className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Everything you log is stamped with the rep you choose here, so the activity log shows who did what.
        </p>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Working as</Label>
          <Select value={validWorkingAs || ALL} onValueChange={(v) => writeWorkingAs(v === ALL ? "" : v)}>
            <SelectTrigger className="h-8 w-[10rem] text-[0.8125rem]">
              <SelectValue placeholder="Choose…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Choose…</SelectItem>
              {reps.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Funnel + this week */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="panel lg:col-span-2">
          <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="text-[0.8125rem] font-semibold">Funnel</h2>
            <span className="text-[0.6875rem] text-muted-foreground">{leads.length} schools</span>
          </header>
          <div className="flex flex-wrap gap-2 p-3">
            {STAGES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStageFilter(stageFilter === s.value ? ALL : s.value)}
                className={`flex min-w-[7rem] flex-col rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted ${
                  stageFilter === s.value ? "border-primary bg-muted" : "border-border"
                }`}
                aria-pressed={stageFilter === s.value}
              >
                <span className="text-lg font-semibold leading-none">{counts[s.value]}</span>
                <span className="mt-1 text-[0.6875rem] text-muted-foreground">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="panel">
          <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="text-[0.8125rem] font-semibold">Follow-ups &amp; this week</h2>
          </header>
          <div className="flex flex-col gap-2 p-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={overdueCount > 0 ? "danger" : "neutral"} label={`${overdueCount} overdue`} />
              <StatusBadge tone={dueTodayCount > 0 ? "warning" : "neutral"} label={`${dueTodayCount} due today`} />
            </div>
            {weekSummary.length === 0 ? (
              <p className="text-[0.75rem] text-muted-foreground">No visits or calls logged yet this week (Mon–Sun).</p>
            ) : (
              <ul className="flex flex-col gap-1 text-[0.8125rem]">
                {weekSummary.map((r) => (
                  <li key={r.repId ?? "none"} className="flex justify-between gap-2">
                    <span>{r.repId ? (repNameById.get(r.repId) ?? "Unknown rep") : "No rep recorded"}</span>
                    <span className="text-muted-foreground">
                      {r.visits} visit{r.visits === 1 ? "" : "s"} · {r.totalActivities} total
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {/* Table */}
      <div className="panel">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <h2 className="mr-auto text-[0.8125rem] font-semibold">
            Schools <span className="font-normal text-muted-foreground">({visibleLeads.length})</span>
          </h2>
          <Input
            aria-label="Search schools"
            placeholder="Search school, town, contact, phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-[16rem] text-[0.8125rem]"
          />
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="h-8 w-[10.5rem] text-[0.8125rem]" aria-label="Filter by stage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All stages</SelectItem>
              {STAGES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={repFilter} onValueChange={setRepFilter}>
            <SelectTrigger className="h-8 w-[9.5rem] text-[0.8125rem]" aria-label="Filter by rep">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All reps</SelectItem>
              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
              {reps.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
              className="size-3.5 rounded border-input"
            />
            Overdue only
          </label>
          <Button size="sm" variant="outline" onClick={handleExport} disabled={visibleLeads.length === 0}>
            Export CSV
          </Button>
          <Button size="sm" onClick={() => setFormLead(null)}>
            Add school
          </Button>
        </header>

        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead className="bg-muted/70">
              <tr>
                <th>School</th>
                <th>Contact</th>
                <th>Stage</th>
                <th>Rep</th>
                <th>Next follow-up</th>
                <th>Last activity</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleLeads.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-muted-foreground">
                    {leads.length === 0
                      ? "No schools yet. Use “Add school” after your first visit."
                      : "No schools match these filters."}
                  </td>
                </tr>
              )}
              {visibleLeads.map((lead) => {
                const overdue = isFollowUpOverdue(lead.next_follow_up_on, lead.stage, today);
                const dueToday = isFollowUpToday(lead.next_follow_up_on, lead.stage, today);
                const leadActivities = activitiesByLead.get(lead.id) ?? [];
                const last = leadActivities.find((a) => a.activity_type !== "stage_change") ?? null;
                return (
                  <Fragment key={lead.id}>
                    <tr>
                      <td>
                        <div className="font-medium">{lead.school_name}</div>
                        <div className="text-[0.75rem] text-muted-foreground">{lead.town_county ?? "—"}</div>
                      </td>
                      <td>
                        <div>{lead.contact_name ?? "—"}</div>
                        <div className="text-[0.75rem] text-muted-foreground">
                          {[lead.contact_role, lead.phone].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </td>
                      <td>
                        <Select
                          value={lead.stage}
                          disabled={pending}
                          onValueChange={(value) => handleStageChange(lead, value)}
                        >
                          <SelectTrigger className="h-7 w-[11.5rem] text-[0.75rem]" aria-label={`Stage for ${lead.school_name}`}>
                            <SelectValue>
                              <StatusBadge tone={stageTone(lead.stage)} label={stageLabel(lead.stage)} />
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {STAGES.map((s) => (
                              <SelectItem key={s.value} value={s.value}>
                                {s.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="text-muted-foreground">
                        {lead.assigned_to ? (repNameById.get(lead.assigned_to) ?? "Unknown") : "Unassigned"}
                      </td>
                      <td>
                        {lead.next_follow_up_on ? (
                          <span className="inline-flex items-center gap-1.5">
                            {formatDateOnly(lead.next_follow_up_on)}
                            {overdue && <StatusBadge tone="danger" label="Overdue" />}
                            {dueToday && <StatusBadge tone="warning" label="Today" />}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="text-muted-foreground">
                        {last ? `${activityLabel(last.activity_type)} · ${formatInstantNairobi(last.created_at)}` : "—"}
                      </td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setExpanded(expanded === lead.id ? null : lead.id)}
                          >
                            {expanded === lead.id ? "Close" : "View"}
                          </Button>
                          <Button size="sm" variant="outline" disabled={pending} onClick={() => setFormLead(lead)}>
                            Edit
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {expanded === lead.id && (
                      <tr>
                        <td colSpan={7} className="bg-muted/30">
                          <LeadDetail
                            lead={lead}
                            activities={leadActivities}
                            repNameById={repNameById}
                            workingAs={validWorkingAs}
                            onDelete={() => setDeleteTarget(lead)}
                            onLogged={() => router.refresh()}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {formLead !== undefined && (
        <LeadFormDialog
          key={formLead?.id ?? "new"}
          lead={formLead}
          reps={reps}
          defaultRepId={validWorkingAs}
          onClose={() => setFormLead(undefined)}
          onSaved={() => {
            setFormLead(undefined);
            router.refresh();
          }}
        />
      )}

      {lostTarget && (
        <LostReasonDialog
          key={lostTarget.id}
          schoolName={lostTarget.school_name}
          pending={pending}
          error={lostError}
          onCancel={() => setLostTarget(null)}
          onConfirm={handleConfirmLost}
        />
      )}

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && !pending && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permanently delete this school?</DialogTitle>
            <DialogDescription>
              This removes {deleteTarget?.school_name} and its whole activity history for good. It can&apos;t be undone.
              If the school just isn&apos;t a fit, mark it Lost instead so the reason is kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={pending}>
              {pending ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LeadDetail({
  lead,
  activities,
  repNameById,
  workingAs,
  onDelete,
  onLogged,
}: {
  lead: SalesLeadRow;
  activities: SalesActivityRow[];
  repNameById: Map<string, string>;
  workingAs: string;
  onDelete: () => void;
  onLogged: () => void;
}) {
  const [type, setType] = useState<ActivityType>("visit");
  const [summary, setSummary] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleLog() {
    setError(null);
    if (!workingAs) {
      setError(NEED_WORKING_AS);
      return;
    }
    startTransition(async () => {
      const res = await addSalesLeadActivity(lead.id, type, summary, workingAs, followUp || null);
      if ("error" in res) setError(res.error);
      else {
        setSummary("");
        setFollowUp("");
        onLogged();
      }
    });
  }

  const facts: [string, string][] = [
    ["Type", lead.school_type ?? "—"],
    ["Students", lead.student_count != null ? String(lead.student_count) : "—"],
    ["Current system", lead.current_system ?? "—"],
    ["Source", sourceLabel(lead.source)],
    ["Email", lead.email ?? "—"],
    ["Added", formatInstantNairobi(lead.created_at)],
  ];

  return (
    <div className="grid gap-4 p-4 text-sm lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <div className="grid gap-1.5 sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <p key={label}>
              <span className="text-muted-foreground">{label}:</span> {value}
            </p>
          ))}
        </div>
        <p>
          <span className="text-muted-foreground">Pain they named:</span> {lead.pain_points ?? "—"}
        </p>
        {lead.stage === "lost" && (
          <p>
            <span className="text-muted-foreground">Lost because:</span> {lead.lost_reason ?? "—"}
          </p>
        )}
        <p>
          <span className="text-muted-foreground">Notes:</span> {lead.notes ?? "—"}
        </p>
        <div>
          <Button size="sm" variant="destructive" onClick={onDelete}>
            Delete school
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="rounded-md border border-border bg-background p-3">
          <p className="mb-2 text-[0.8125rem] font-semibold">Log an activity</p>
          <div className="grid gap-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={type} onValueChange={(v) => setType(v as ActivityType)}>
                <SelectTrigger className="h-8 text-[0.8125rem]" aria-label="Activity type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIVITY_TYPES.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                aria-label="Next follow-up date"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                className="h-8 text-[0.8125rem]"
              />
            </div>
            <Textarea
              rows={2}
              maxLength={2000}
              placeholder="What happened? Who did you meet? What did they say?"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
            <p className="text-[0.6875rem] text-muted-foreground">
              Setting a date moves this school&apos;s next follow-up. Leave it empty to keep the current one.
            </p>
            {error && (
              <p role="alert" className="text-[0.8125rem] text-danger">
                {error}
              </p>
            )}
            <div>
              <Button size="sm" onClick={handleLog} disabled={pending || summary.trim() === ""}>
                {pending ? "Saving…" : "Save activity"}
              </Button>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[0.8125rem] font-semibold">History</p>
          {activities.length === 0 ? (
            <p className="text-[0.8125rem] text-muted-foreground">Nothing logged yet.</p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
              {activities.map((a) => (
                <li key={a.id} className="rounded-md border border-border bg-background px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[0.6875rem] text-muted-foreground">
                    <span className="font-medium text-foreground">{activityLabel(a.activity_type)}</span>
                    <span>
                      {a.performed_by ? (repNameById.get(a.performed_by) ?? "Unknown rep") : "No rep recorded"} ·{" "}
                      {formatInstantNairobi(a.created_at, true)}
                    </span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-[0.8125rem]">{a.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
