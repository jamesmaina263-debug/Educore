"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { addCandidateAction, addNoteAction, moveCandidateAction, saveOpeningAction } from "@/app/(app)/staff/recruitment/actions";
import {
  EMPLOYMENT_LABELS,
  EMPLOYMENT_TYPES,
  LIVE_STAGES,
  NEXT_STAGES,
  OPENING_STATUSES,
  OPENING_STATUS_LABELS,
  STAGES,
  STAGE_LABELS,
  isClosingSoon,
  isPastClosing,
  openingProgress,
  type EmploymentType,
  type OpeningInput,
  type OpeningStatus,
  type Stage,
} from "@/lib/recruitment";

export interface OpeningRow {
  id: string;
  title: string;
  department: string;
  employmentType: EmploymentType;
  description: string;
  positions: number;
  closesOn: string | null;
  status: OpeningStatus;
}
export interface CandidateRow {
  id: string;
  openingId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  stage: Stage;
  stageChangedAt: string;
}
export interface EventRow {
  id: string;
  candidateId: string;
  kind: "stage" | "note";
  fromStage: Stage | null;
  toStage: Stage | null;
  body: string | null;
  createdAt: string;
}

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

const EMPTY_OPENING: OpeningInput = {
  id: null, title: "", department: "", employmentType: "full_time", description: "", positions: 1, closesOn: "", status: "open",
};

function stageTone(s: Stage): "success" | "danger" | "info" | "neutral" | "warning" {
  if (s === "hired") return "success";
  if (s === "rejected") return "danger";
  if (s === "withdrawn") return "neutral";
  if (s === "offer") return "warning";
  return "info";
}

function openingTone(s: OpeningStatus): "success" | "neutral" | "info" | "danger" {
  if (s === "open") return "success";
  if (s === "filled") return "info";
  if (s === "cancelled") return "danger";
  return "neutral";
}

function fmt(ts: string): string {
  return new Date(ts).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

export function RecruitmentSection({
  openings,
  candidates,
  events,
  today,
}: {
  openings: OpeningRow[];
  candidates: CandidateRow[];
  events: EventRow[];
  today: string;
}) {
  const [selected, setSelected] = useState<string | null>(openings[0]?.id ?? null);
  const [form, setForm] = useState<OpeningInput | null>(null);
  const [cand, setCand] = useState<{ fullName: string; email: string; phone: string; source: string } | null>(null);
  const [openCandidate, setOpenCandidate] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const opening = openings.find((o) => o.id === selected) ?? null;
  const forOpening = candidates.filter((c) => c.openingId === selected);

  async function run(fn: () => Promise<{ error: string } | { success: true }>, ok: string, after?: () => void) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      if ("error" in result) setError(result.error);
      else {
        setNotice(ok);
        after?.();
      }
    } finally {
      setBusy(false);
    }
  }

  function editOpening(o: OpeningRow) {
    setForm({
      id: o.id, title: o.title, department: o.department, employmentType: o.employmentType, description: o.description,
      positions: o.positions, closesOn: o.closesOn ?? "", status: o.status,
    });
    setError(null);
    setNotice(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Recruitment</h1>
        <p className="text-sm text-muted-foreground">
          Track openings and candidates through each hiring stage. This only keeps records: nothing is sent to candidates, no login is
          created, and marking someone hired does not add them to staff.
        </p>
      </div>
      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      {notice && <p className="rounded-md border p-2 text-sm text-muted-foreground">{notice}</p>}

      <div className="panel p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold">{form ? (form.id ? "Edit opening" : "New opening") : "Openings"}</p>
          {!form && (
            <Button size="sm" onClick={() => { setForm(EMPTY_OPENING); setError(null); setNotice(null); }}>
              New opening
            </Button>
          )}
        </div>
        {form && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="op-title">Title</Label>
              <Input id="op-title" value={form.title} maxLength={150} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="op-dept">Department (optional)</Label>
              <Input id="op-dept" value={form.department} maxLength={100} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="op-type">Employment type</Label>
              <select id="op-type" className={selectClass} value={form.employmentType} onChange={(e) => setForm({ ...form, employmentType: e.target.value as EmploymentType })}>
                {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{EMPLOYMENT_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="op-pos">Positions</Label>
              <Input id="op-pos" type="number" min={1} max={100} value={form.positions} onChange={(e) => setForm({ ...form, positions: Number(e.target.value) })} />
            </div>
            <div>
              <Label htmlFor="op-close">Closing date (optional)</Label>
              <Input id="op-close" type="date" value={form.closesOn} onChange={(e) => setForm({ ...form, closesOn: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="op-status">Status</Label>
              <select id="op-status" className={selectClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as OpeningStatus })}>
                {OPENING_STATUSES.map((s) => <option key={s} value={s}>{OPENING_STATUS_LABELS[s]}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="op-desc">Description (optional)</Label>
              <Textarea id="op-desc" rows={3} maxLength={4000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button disabled={busy} onClick={() => run(() => saveOpeningAction(form), "Opening saved.", () => setForm(null))}>
                {busy ? "Saving..." : "Save opening"}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setForm(null)}>Close</Button>
            </div>
          </div>
        )}
        {openings.length === 0 && !form ? (
          <p className="text-sm text-muted-foreground">No openings yet. Add one to start receiving candidates.</p>
        ) : (
          <ul className="divide-y divide-border">
            {openings.map((o) => {
              const p = openingProgress(o.positions, candidates.filter((c) => c.openingId === o.id));
              return (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <button type="button" className="min-w-0 text-left" onClick={() => setSelected(o.id)} aria-pressed={selected === o.id}>
                    <p className={`truncate text-sm font-medium ${selected === o.id ? "text-primary" : ""}`}>{o.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {EMPLOYMENT_LABELS[o.employmentType]}{o.department ? ` · ${o.department}` : ""} · {p.hired}/{o.positions} hired · {p.live} in progress · {p.total} total
                      {o.closesOn ? ` · closes ${o.closesOn}` : ""}
                    </p>
                  </button>
                  <div className="flex items-center gap-2">
                    {isClosingSoon(o.closesOn, o.status, today) && <StatusBadge tone="warning" label="Closing soon" />}
                    {isPastClosing(o.closesOn, o.status, today) && <StatusBadge tone="warning" label="Past closing date" />}
                    <StatusBadge tone={openingTone(o.status)} label={OPENING_STATUS_LABELS[o.status]} />
                    <Button variant="outline" size="sm" onClick={() => editOpening(o)}>Edit</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {opening && (
        <div className="panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold">Candidates for {opening.title}</p>
            {opening.status === "open" && !cand && (
              <Button size="sm" onClick={() => setCand({ fullName: "", email: "", phone: "", source: "" })}>Add candidate</Button>
            )}
          </div>
          {opening.status !== "open" && (
            <p className="mb-3 text-sm text-muted-foreground">Candidates can only be added while the opening is open.</p>
          )}
          {cand && (
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="c-name">Full name</Label>
                <Input id="c-name" value={cand.fullName} maxLength={120} onChange={(e) => setCand({ ...cand, fullName: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="c-email">Email (optional)</Label>
                <Input id="c-email" type="email" value={cand.email} maxLength={200} onChange={(e) => setCand({ ...cand, email: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="c-phone">Phone (optional)</Label>
                <Input id="c-phone" value={cand.phone} maxLength={30} onChange={(e) => setCand({ ...cand, phone: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="c-src">Source (optional)</Label>
                <Input id="c-src" value={cand.source} maxLength={100} placeholder="Referral, newspaper, walk-in..." onChange={(e) => setCand({ ...cand, source: e.target.value })} />
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <Button disabled={busy} onClick={() => run(() => addCandidateAction({ openingId: opening.id, ...cand }), "Candidate added.", () => setCand(null))}>
                  {busy ? "Saving..." : "Add candidate"}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setCand(null)}>Close</Button>
              </div>
            </div>
          )}

          {forOpening.length === 0 ? (
            <p className="text-sm text-muted-foreground">No candidates yet.</p>
          ) : (
            STAGES.map((stage) => {
              const rows = forOpening.filter((c) => c.stage === stage);
              if (rows.length === 0) return null;
              return (
                <div key={stage} className="mb-4 last:mb-0">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {STAGE_LABELS[stage]} ({rows.length})
                  </p>
                  <ul className="divide-y divide-border rounded-md border">
                    {rows.map((c) => {
                      const history = events.filter((e) => e.candidateId === c.id);
                      const isOpen = openCandidate === c.id;
                      return (
                        <li key={c.id} className="p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <button type="button" className="text-left" onClick={() => { setOpenCandidate(isOpen ? null : c.id); setNote(""); }} aria-expanded={isOpen}>
                              <p className="text-sm font-medium">{c.fullName}</p>
                              <p className="text-xs text-muted-foreground">
                                {[c.email, c.phone, c.source].filter(Boolean).join(" · ") || "No contact details"}
                              </p>
                            </button>
                            <StatusBadge tone={stageTone(c.stage)} label={STAGE_LABELS[c.stage]} />
                          </div>
                          {isOpen && (
                            <div className="mt-3 flex flex-col gap-3">
                              {NEXT_STAGES[c.stage].length > 0 ? (
                                <div className="flex flex-col gap-2">
                                  <Label htmlFor={`note-${c.id}`}>Note (required to reject)</Label>
                                  <Textarea id={`note-${c.id}`} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
                                  <div className="flex flex-wrap gap-2">
                                    {NEXT_STAGES[c.stage].map((to) => (
                                      <Button
                                        key={to}
                                        size="sm"
                                        variant={to === "rejected" || to === "withdrawn" ? "outline" : "default"}
                                        disabled={busy}
                                        onClick={() => run(() => moveCandidateAction(c.id, c.stage, to, note), `Moved to ${STAGE_LABELS[to]}.`, () => { setNote(""); })}
                                      >
                                        {to === "rejected" ? "Reject" : to === "withdrawn" ? "Mark withdrawn" : `Move to ${STAGE_LABELS[to]}`}
                                      </Button>
                                    ))}
                                    <Button size="sm" variant="outline" disabled={busy || note.trim().length === 0} onClick={() => run(() => addNoteAction(c.id, note), "Note added.", () => setNote(""))}>
                                      Save as note only
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex flex-col gap-2">
                                  <Label htmlFor={`note-${c.id}`}>Add a note</Label>
                                  <Textarea id={`note-${c.id}`} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
                                  <div>
                                    <Button size="sm" variant="outline" disabled={busy || note.trim().length === 0} onClick={() => run(() => addNoteAction(c.id, note), "Note added.", () => setNote(""))}>
                                      Save note
                                    </Button>
                                  </div>
                                </div>
                              )}
                              <div>
                                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">History</p>
                                <ul className="flex flex-col gap-1 text-sm">
                                  {history.map((e) => (
                                    <li key={e.id} className="text-muted-foreground">
                                      <span className="text-foreground">
                                        {e.kind === "stage"
                                          ? e.fromStage ? `${STAGE_LABELS[e.fromStage]} to ${STAGE_LABELS[e.toStage as Stage]}` : STAGE_LABELS[e.toStage as Stage]
                                          : "Note"}
                                      </span>
                                      {e.body ? `: ${e.body}` : ""} · {fmt(e.createdAt)}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Live stages: {LIVE_STAGES.map((s) => STAGE_LABELS[s]).join(", ")}. Hired, rejected and withdrawn are final.
          </p>
        </div>
      )}
    </div>
  );
}
