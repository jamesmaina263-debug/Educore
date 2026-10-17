"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  deleteOutboundProspect,
  discoverSchoolsByCounty,
  importOutboundProspects,
  promoteOutboundProspect,
  reviewOutboundProspect,
  scoreOutboundProspects,
} from "@/app/(admin)/admin/outreach/actions";
import { KENYA_COUNTIES } from "@/lib/outbound/discovery";
import { MAX_SCORE_BATCH, SCHOOL_LEVEL_LABELS, type OutboundSchoolLevel } from "@/lib/outbound/prospects";

export type OutboundProspectRow = {
  id: string;
  school_name: string;
  town_county: string | null;
  school_type: string | null;
  school_level: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  source_note: string | null;
  fit_score: number | null;
  fit_reason: string | null;
  draft_email_subject: string | null;
  draft_email_body: string | null;
  draft_whatsapp: string | null;
  status: "new" | "scored" | "approved" | "rejected" | "promoted";
};

type Tone = "success" | "warning" | "danger" | "info" | "neutral";
const STATUS: Record<OutboundProspectRow["status"], { label: string; tone: Tone }> = {
  new: { label: "Not scored", tone: "neutral" },
  scored: { label: "To review", tone: "info" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  promoted: { label: "In pipeline", tone: "success" },
};
const FILTERS = ["all", "new", "scored", "approved", "rejected", "promoted"] as const;
type Filter = (typeof FILTERS)[number];

export function AdminOutreach({
  prospects,
  reps,
}: {
  prospects: OutboundProspectRow[];
  reps: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const [county, setCounty] = useState<string>("");
  const [kinds, setKinds] = useState<string>("all");
  const [csvText, setCsvText] = useState("");
  const [csvSource, setCsvSource] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<OutboundProspectRow | null>(null);
  const [promoteRep, setPromoteRep] = useState<string>("");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: prospects.length };
    for (const p of prospects) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [prospects]);
  const visible = useMemo(
    () => (filter === "all" ? prospects : prospects.filter((p) => p.status === filter)),
    [prospects, filter],
  );

  function run(fn: () => Promise<{ error: string } | ({ success: true } & Record<string, unknown>)>, ok: (r: Record<string, unknown>) => string) {
    setNotice(null);
    startTransition(async () => {
      const r = await fn();
      if (typeof r.error === "string") setNotice({ tone: "error", text: r.error });
      else {
        setNotice({ tone: "ok", text: ok(r) });
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const scorable = [...selected].filter((id) => {
    const s = prospects.find((p) => p.id === id)?.status;
    return s === "new" || s === "scored";
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ tone: "ok", text: "Copied." });
    } catch {
      setNotice({ tone: "error", text: "Couldn't copy. Select the text and copy it manually." });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={`panel p-3 text-sm ${notice.tone === "error" ? "text-destructive" : ""}`}
        >
          {notice.text}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel flex flex-col gap-3 p-4" aria-labelledby="discover-h">
          <h2 id="discover-h" className="text-sm font-semibold">
            Discover schools automatically
          </h2>
          <p className="text-xs text-muted-foreground">
            Pulls named schools and kindergartens for one county from OpenStreetMap. Phone and email are often missing
            there, so expect to add contacts for the schools you pursue. Found schools are only staged for review.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="county">County</Label>
              <Select value={county} onValueChange={setCounty}>
                <SelectTrigger id="county" className="h-8 w-[11rem] text-[0.8125rem]">
                  <SelectValue placeholder="Choose county…" />
                </SelectTrigger>
                <SelectContent>
                  {KENYA_COUNTIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="kinds">Include</Label>
              <Select value={kinds} onValueChange={setKinds}>
                <SelectTrigger id="kinds" className="h-8 w-[12rem] text-[0.8125rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Schools and kindergartens</SelectItem>
                  <SelectItem value="kindergartens">Kindergartens only</SelectItem>
                  <SelectItem value="schools">Schools only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              disabled={pending || !county}
              onClick={() =>
                run(
                  () => discoverSchoolsByCounty(county, kinds),
                  (r) =>
                    `Found ${r.found} in ${county}: ${r.inserted} new, ${r.skipped} already known` +
                    `${Number(r.truncated) > 0 ? `, ${r.truncated} more left out (run again after reviewing)` : ""}. ` +
                    `${r.withContact} have a phone or email.`,
                )
              }
            >
              {pending ? "Working…" : "Discover"}
            </Button>
          </div>
        </section>

        <section className="panel flex flex-col gap-3 p-4" aria-labelledby="import-h">
          <h2 id="import-h" className="text-sm font-semibold">
            Import a list (CSV)
          </h2>
          <p className="text-xs text-muted-foreground">
            Needs a <code>school_name</code> column. Optional: county, type, level, website, phone, email, contact_name,
            contact_role, students. Up to 500 rows.
          </p>
          <Textarea
            aria-label="CSV contents"
            rows={4}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="school_name,county,level,phone&#10;Sunrise Academy,Nakuru,primary,0712345678"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Where did this list come from?"
              className="h-8 w-[16rem] text-[0.8125rem]"
              value={csvSource}
              onChange={(e) => setCsvSource(e.target.value)}
              placeholder="Where did this list come from?"
              maxLength={300}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !csvText.trim() || !csvSource.trim()}
              onClick={() =>
                run(
                  () => importOutboundProspects(csvText, csvSource),
                  (r) => {
                    const w = r.warnings as string[];
                    return `Imported ${r.inserted}, skipped ${r.skipped} already known.${w.length ? ` ${w.length} row warning(s): ${w.slice(0, 3).join(" ")}` : ""}`;
                  },
                )
              }
            >
              Import
            </Button>
          </div>
        </section>
      </div>

      <section className="panel p-4" aria-labelledby="queue-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="queue-h" className="text-sm font-semibold">
            Prospects
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={pending || scorable.length === 0 || scorable.length > MAX_SCORE_BATCH}
              onClick={() =>
                run(
                  () => scoreOutboundProspects(scorable),
                  (r) =>
                    `Scored ${r.scored}${Number(r.failed) > 0 ? `, ${r.failed} failed (try again)` : ""}${
                      Number(r.skipped) > 0 ? `, ${r.skipped} left for the next click (time limit)` : ""
                    }.`,
                )
              }
            >
              Score &amp; draft selected ({scorable.length}/{MAX_SCORE_BATCH})
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <Button
              key={f}
              role="tab"
              aria-selected={filter === f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : STATUS[f].label} ({counts[f] ?? 0})
            </Button>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {prospects.length === 0 ? "No prospects yet. Discover a county or import a list to begin." : "Nothing in this view."}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[0.8125rem]">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="p-2" scope="col">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="p-2" scope="col">School</th>
                  <th className="p-2" scope="col">Level</th>
                  <th className="p-2" scope="col">Contact</th>
                  <th className="p-2" scope="col">Fit</th>
                  <th className="p-2" scope="col">Status</th>
                  <th className="p-2" scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const st = STATUS[p.status];
                  const canSelect = p.status === "new" || p.status === "scored";
                  return (
                    <tr key={p.id} className="border-t border-border align-top">
                      <td className="p-2">
                        {canSelect && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${p.school_name}`}
                            checked={selected.has(p.id)}
                            onChange={() => toggle(p.id)}
                          />
                        )}
                      </td>
                      <td className="p-2">
                        <div className="font-medium">{p.school_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {[p.town_county, p.school_type].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className="p-2">
                        {p.school_level ? SCHOOL_LEVEL_LABELS[p.school_level as OutboundSchoolLevel] ?? p.school_level : "—"}
                      </td>
                      <td className="p-2 text-xs">
                        {p.phone || p.email ? (
                          <>
                            {p.phone && <div>{p.phone}</div>}
                            {p.email && <div>{p.email}</div>}
                          </>
                        ) : (
                          <span className="text-muted-foreground">None found</span>
                        )}
                      </td>
                      <td className="p-2 tabular-nums">{p.fit_score ?? "—"}</td>
                      <td className="p-2">
                        <StatusBadge tone={st.tone} label={st.label} />
                      </td>
                      <td className="p-2">
                        <Button size="sm" variant="outline" onClick={() => setOpen(p)}>
                          Open
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{open.school_name}</DialogTitle>
                <DialogDescription>
                  {[open.town_county, open.school_level && SCHOOL_LEVEL_LABELS[open.school_level as OutboundSchoolLevel]]
                    .filter(Boolean)
                    .join(" · ")}
                  {open.source_note ? ` — Source: ${open.source_note}` : ""}
                </DialogDescription>
              </DialogHeader>

              {open.fit_reason && (
                <p className="text-sm">
                  <span className="font-medium">Fit {open.fit_score}/100.</span> {open.fit_reason}
                </p>
              )}

              {open.draft_email_body ? (
                <div className="flex flex-col gap-3 text-sm">
                  <p className="text-xs text-muted-foreground">
                    Drafts only. Review and edit before using; nothing is sent from here.
                  </p>
                  <div className="rounded border border-border p-3">
                    <div className="mb-1 text-xs font-medium">Email: {open.draft_email_subject}</div>
                    <p className="whitespace-pre-wrap">{open.draft_email_body}</p>
                    <Button
                      className="mt-2"
                      size="sm"
                      variant="outline"
                      onClick={() => copy(`${open.draft_email_subject}\n\n${open.draft_email_body}`)}
                    >
                      Copy email
                    </Button>
                  </div>
                  <div className="rounded border border-border p-3">
                    <div className="mb-1 text-xs font-medium">WhatsApp</div>
                    <p className="whitespace-pre-wrap">{open.draft_whatsapp}</p>
                    <Button className="mt-2" size="sm" variant="outline" onClick={() => copy(open.draft_whatsapp ?? "")}>
                      Copy WhatsApp
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Not scored yet. Select it in the list and use “Score &amp; draft”.</p>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                {open.status === "scored" && (
                  <>
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() => run(() => reviewOutboundProspect(open.id, "approved"), () => "Approved.")}
                    >
                      Approve
                    </Button>
                  </>
                )}
                {(open.status === "new" || open.status === "scored") && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => run(() => reviewOutboundProspect(open.id, "rejected"), () => "Rejected.")}
                  >
                    Reject
                  </Button>
                )}
                {(open.status === "approved" || open.status === "rejected") && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => run(() => reviewOutboundProspect(open.id, "scored"), () => "Moved back to review.")}
                  >
                    Undo
                  </Button>
                )}
                {open.status === "approved" && (
                  <>
                    <Select value={promoteRep} onValueChange={setPromoteRep}>
                      <SelectTrigger aria-label="Assign to rep" className="h-8 w-[10rem] text-[0.8125rem]">
                        <SelectValue placeholder="Assign to…" />
                      </SelectTrigger>
                      <SelectContent>
                        {reps.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        run(() => promoteOutboundProspect(open.id, promoteRep || null), () => "Added to the sales pipeline.")
                      }
                    >
                      Add to pipeline
                    </Button>
                  </>
                )}
                {open.status !== "promoted" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto text-destructive"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(`Delete ${open.school_name}? This can't be undone.`)) {
                        run(() => deleteOutboundProspect(open.id), () => "Deleted.");
                        setOpen(null);
                      }
                    }}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
