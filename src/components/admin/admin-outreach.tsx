"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  confirmOutboundContacts,
  deleteOutboundProspect,
  enrichOutboundProspects,
  discoverSchoolsByCounty,
  importOutboundProspects,
  loadProspectContact,
  logOutboundContact,
  promoteOutboundProspect,
  recordProspectOptOut,
  reviewOutboundProspect,
  scoreOutboundProspects,
  updateOutboundContacts,
} from "@/app/(admin)/admin/outreach/actions";
import { KENYA_COUNTIES } from "@/lib/outbound/discovery";
import { OWNERSHIP_FILTERS, OWNERSHIP_LABELS, ownershipSignal, passesOwnershipFilter, type OwnershipFilter } from "@/lib/outbound/ownership";
import { MAX_ENRICH_BATCH } from "@/lib/outbound/enrichment";
import {
  CHANNEL_LABELS,
  contactBlockReason,
  describeContactEvent,
  type ContactChannel,
  type ContactLogRow,
  type ProspectContactSummary,
} from "@/lib/outbound/contact";
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
  contact_name: string | null;
  contact_role: string | null;
  contact_status: "scraped" | "ai_found" | "verified" | null;
  contact_source_url: string | null;
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

type ContactState = {
  loading: boolean;
  error: string | null;
  blocked: { email: boolean; whatsapp: boolean } | null;
  log: ContactLogRow[];
};

const OPT_OUT_LABELS: Record<string, string> = {
  stop_reply: "Replied STOP",
  requested: "Asked not to be contacted",
  complained: "Complained",
};

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-KE", { day: "numeric", month: "short" });
}

export function AdminOutreach({
  prospects,
  reps,
  contactEnabled,
  contactSummary,
}: {
  prospects: OutboundProspectRow[];
  reps: { id: string; name: string }[];
  contactEnabled: boolean;
  contactSummary: Record<string, ProspectContactSummary>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const [county, setCounty] = useState<string>("");
  const [kinds, setKinds] = useState<string>("all");
  const [discoverOwnership, setDiscoverOwnership] = useState<string>("hide_public");
  const [listOwnership, setListOwnership] = useState<OwnershipFilter>("all");
  const [csvText, setCsvText] = useState("");
  const [csvSource, setCsvSource] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openSnap, setOpen] = useState<OutboundProspectRow | null>(null);
  // The dialog shows the latest server data for the open row, not the snapshot from when it was opened.
  const open = openSnap ? (prospects.find((p) => p.id === openSnap.id) ?? openSnap) : null;
  const [promoteRep, setPromoteRep] = useState<string>("");
  const [contact, setContact] = useState<ContactState | null>(null);
  const [actor, setActor] = useState<string>("");
  const [optReason, setOptReason] = useState<string>("stop_reply");
  const openId = useRef<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: prospects.length };
    for (const p of prospects) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [prospects]);
  const visible = useMemo(
    () =>
      prospects.filter(
        (p) =>
          (filter === "all" || p.status === filter) &&
          passesOwnershipFilter(ownershipSignal(p), listOwnership),
      ),
    [prospects, filter, listOwnership],
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

  const enrichable = [...selected].filter((id) => {
    const p = prospects.find((x) => x.id === id);
    return p && p.status !== "promoted" && (!p.phone || !p.email);
  });

  const repName = (id: string | null | undefined) => reps.find((r) => r.id === id)?.name ?? null;

  async function refreshContact(id: string) {
    const r = await loadProspectContact(id);
    if (openId.current !== id) return; // dialog moved on
    if ("error" in r) setContact({ loading: false, error: r.error, blocked: null, log: [] });
    else setContact({ loading: false, error: null, blocked: r.blocked, log: r.log });
  }

  function openProspect(p: OutboundProspectRow | null) {
    setOpen(p);
    openId.current = p?.id ?? null;
    setContact(null);
    if (p && contactEnabled) {
      setContact({ loading: true, error: null, blocked: null, log: [] });
      void refreshContact(p.id);
    }
  }

  const contactValue = (p: OutboundProspectRow, ch: ContactChannel) => (ch === "email" ? p.email : p.phone);
  const blockReason = (p: OutboundProspectRow, ch: ContactChannel) =>
    contactBlockReason(
      {
        status: p.status,
        contactStatus: p.contact_status,
        contactValue: contactValue(p, ch),
        blocked: contact?.blocked ? contact.blocked[ch] : null,
      },
      ch,
    );

  // Copy first, then log: browsers only allow clipboard writes inside the click, so we must not wait
  // for the server before copying. The button is already disabled for anything the database would
  // refuse; if it refuses anyway (e.g. an opt-out recorded a second ago) we say so.
  const copyDraft = async (p: OutboundProspectRow, ch: ContactChannel, text: string) => {
    if (contactEnabled && blockReason(p, ch)) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setNotice({ tone: "error", text: "Couldn't copy. Select the text and copy it manually." });
      return;
    }
    if (!contactEnabled) {
      setNotice({ tone: "ok", text: "Copied." });
      return;
    }
    const r = await logOutboundContact(p.id, ch, "draft_copied", actor || null);
    if ("error" in r) {
      setNotice({ tone: "error", text: `Copied, but it was not logged: ${r.error}. Do not send it if this contact has opted out.` });
    } else {
      setNotice({ tone: "ok", text: "Copied and logged." });
    }
    void refreshContact(p.id);
    router.refresh();
  };

  function logEvent(p: OutboundProspectRow, ch: ContactChannel, event: "sent" | "replied") {
    setNotice(null);
    startTransition(async () => {
      const r = await logOutboundContact(p.id, ch, event, actor || null);
      if ("error" in r) setNotice({ tone: "error", text: r.error });
      else {
        setNotice({ tone: "ok", text: event === "sent" ? `${CHANNEL_LABELS[ch]} marked as sent.` : "Reply logged." });
        void refreshContact(p.id);
        router.refresh();
      }
    });
  }

  function optOut(p: OutboundProspectRow, ch: ContactChannel) {
    const what = ch === "email" ? "email address" : "phone number";
    if (!window.confirm(`Record that ${p.school_name} must not be contacted on this ${what}? This is permanent and also stops it being re-imported.`)) return;
    setNotice(null);
    startTransition(async () => {
      const r = await recordProspectOptOut(p.id, ch, optReason);
      if ("error" in r) setNotice({ tone: "error", text: r.error });
      else {
        setNotice({ tone: "ok", text: `${CHANNEL_LABELS[ch]} opt-out recorded.` });
        void refreshContact(p.id);
        router.refresh();
      }
    });
  }

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
            <div className="flex flex-col gap-1">
              <Label htmlFor="ownership">Ownership</Label>
              <Select value={discoverOwnership} onValueChange={setDiscoverOwnership}>
                <SelectTrigger id="ownership" className="h-8 w-[15rem] text-[0.8125rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OWNERSHIP_FILTERS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              disabled={pending || !county}
              onClick={() =>
                run(
                  () => discoverSchoolsByCounty(county, kinds, discoverOwnership),
                  (r) =>
                    `Found ${r.found} in ${county}: ${r.inserted} new, ${r.skipped} already known` +
                    `${Number(r.hidden) > 0 ? `, ${r.hidden} hidden as likely public` : ""}` +
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
            <Button
              size="sm"
              variant="outline"
              disabled={pending || enrichable.length === 0 || enrichable.length > MAX_ENRICH_BATCH}
              onClick={() =>
                run(
                  () => enrichOutboundProspects(enrichable),
                  (r) =>
                    `Found contact details for ${r.enriched}, nothing found for ${r.notFound}${Number(r.failed) > 0 ? `, ${r.failed} failed` : ""}. ` +
                    `${Number(r.enriched) > 0 ? "Found details are unverified: open each one, check the source link, then confirm. " : ""}` +
                    `${r.searchUnavailable ? `Web search was skipped: ${r.searchUnavailable} Schools with a website were still read directly; for the rest, open the school and type the contacts in. ` : ""}` +
                    `${!r.searchUnavailable && r.note && Number(r.enriched) === 0 ? `(Lookup note: ${r.note})` : ""}`,
                )
              }
            >
              {pending ? "Working…" : `Find contacts (${enrichable.length}/${MAX_ENRICH_BATCH})`}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Label htmlFor="list-ownership" className="text-xs">
            Show
          </Label>
          <Select value={listOwnership} onValueChange={(v) => setListOwnership(v as OwnershipFilter)}>
            <SelectTrigger id="list-ownership" className="h-8 w-[15rem] text-[0.8125rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All schools</SelectItem>
              <SelectItem value="hide_public">Hide likely public</SelectItem>
              <SelectItem value="private_only">Private-leaning only</SelectItem>
            </SelectContent>
          </Select>
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
                  const canSelect = p.status !== "promoted";
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
                        {ownershipSignal(p) !== "unknown" && (
                          <div className="text-[0.6875rem] text-muted-foreground">{OWNERSHIP_LABELS[ownershipSignal(p)]}</div>
                        )}
                      </td>
                      <td className="p-2">
                        {p.school_level ? SCHOOL_LEVEL_LABELS[p.school_level as OutboundSchoolLevel] ?? p.school_level : "—"}
                      </td>
                      <td className="p-2 text-xs">
                        {p.phone || p.email ? (
                          <>
                            {p.phone && <div>{p.phone}</div>}
                            {p.email && <div>{p.email}</div>}
                            {p.contact_status === "scraped" || p.contact_status === "ai_found" ? (
                              <div className="text-[0.6875rem] text-amber-700">Unverified — check source</div>
                            ) : p.contact_status === "verified" ? (
                              <div className="text-[0.6875rem] text-green-700">Confirmed</div>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-muted-foreground">None found</span>
                        )}
                      </td>
                      <td className="p-2 tabular-nums">{p.fit_score ?? "—"}</td>
                      <td className="p-2">
                        <StatusBadge tone={st.tone} label={st.label} />
                        {contactEnabled && contactSummary[p.id]?.optedOut.length ? (
                          <div className="mt-1 text-xs text-destructive">
                            Opted out ({contactSummary[p.id].optedOut.map((c) => CHANNEL_LABELS[c as ContactChannel] ?? c).join(", ")})
                          </div>
                        ) : null}
                        {contactEnabled && contactSummary[p.id]?.last ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {describeContactEvent(contactSummary[p.id].last!.channel, contactSummary[p.id].last!.event)} ·{" "}
                            {shortDate(contactSummary[p.id].last!.created_at)}
                          </div>
                        ) : null}
                      </td>
                      <td className="p-2">
                        <Button size="sm" variant="outline" onClick={() => openProspect(p)}>
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

      <Dialog open={open !== null} onOpenChange={(o) => !o && openProspect(null)}>
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

              <div className="rounded border border-border p-3 text-sm">
                <div className="mb-1 text-xs font-medium">Contact details</div>
                {open.website || open.phone || open.email || open.contact_name ? (
                  <ul className="flex flex-col gap-0.5">
                    {open.contact_name && (
                      <li>
                        {open.contact_name}
                        {open.contact_role ? `, ${open.contact_role}` : ""}
                      </li>
                    )}
                    {open.phone && <li>{open.phone}</li>}
                    {open.email && <li>{open.email}</li>}
                    {open.website && <li>{open.website}</li>}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">None yet. Select it in the list and use “Find contacts”.</p>
                )}
                {open.contact_source_url && (
                  <p className="mt-2 text-xs">
                    Source:{" "}
                    <a className="underline" href={open.contact_source_url} target="_blank" rel="noopener noreferrer">
                      {open.contact_source_url}
                    </a>
                  </p>
                )}
                {(open.contact_status === "scraped" || open.contact_status === "ai_found") && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-amber-700">
                      {open.contact_status === "ai_found" ? "Found by AI web search" : "Taken from the school's website"}
                      {" "}— open the source and check before confirming.
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => run(() => confirmOutboundContacts(open.id), () => "Contact details confirmed.")}
                    >
                      Confirm contacts
                    </Button>
                  </div>
                )}
                {open.contact_status === "verified" && <p className="mt-2 text-xs text-green-700">Confirmed by a person.</p>}
                {open.status !== "promoted" && (
                  <ContactEditor
                    key={`${open.id}:${open.phone ?? ""}:${open.email ?? ""}:${open.website ?? ""}:${open.contact_name ?? ""}`}
                    prospect={open}
                    pending={pending}
                    onSave={(fields) =>
                      run(() => updateOutboundContacts(open.id, fields), () => "Contact details saved and marked as confirmed.")
                    }
                  />
                )}
              </div>

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
                      disabled={contactEnabled && blockReason(open, "email") !== null}
                      onClick={() => copyDraft(open, "email", `${open.draft_email_subject}\n\n${open.draft_email_body}`)}
                    >
                      Copy email
                    </Button>
                    {contactEnabled && blockReason(open, "email") && (
                      <p className="mt-1 text-xs text-muted-foreground">{blockReason(open, "email")}</p>
                    )}
                  </div>
                  <div className="rounded border border-border p-3">
                    <div className="mb-1 text-xs font-medium">WhatsApp</div>
                    <p className="whitespace-pre-wrap">{open.draft_whatsapp}</p>
                    <Button
                      className="mt-2"
                      size="sm"
                      variant="outline"
                      disabled={contactEnabled && blockReason(open, "whatsapp") !== null}
                      onClick={() => copyDraft(open, "whatsapp", open.draft_whatsapp ?? "")}
                    >
                      Copy WhatsApp
                    </Button>
                    {contactEnabled && blockReason(open, "whatsapp") && (
                      <p className="mt-1 text-xs text-muted-foreground">{blockReason(open, "whatsapp")}</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Not scored yet. Select it in the list and use “Score &amp; draft”.</p>
              )}

              {contactEnabled && (open.status === "approved" || open.status === "promoted") && (
                <div className="flex flex-col gap-3 rounded border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-medium">Contact log (recorded by hand; not proof of delivery)</div>
                    <Select value={actor} onValueChange={setActor}>
                      <SelectTrigger aria-label="Who is logging" className="h-8 w-[11rem] text-[0.8125rem]">
                        <SelectValue placeholder="Logging as… (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        {reps.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {contact?.error && <p className="text-xs text-destructive">Couldn&apos;t load contact status: {contact.error}</p>}
                  {(["email", "whatsapp"] as const).map((ch) => {
                    const reason = blockReason(open, ch);
                    return (
                      <div key={ch} className="flex flex-wrap items-center gap-2">
                        <span className="w-20 text-xs font-medium">{CHANNEL_LABELS[ch]}</span>
                        <Button size="sm" variant="outline" disabled={pending || reason !== null} onClick={() => logEvent(open, ch, "sent")}>
                          Mark as sent
                        </Button>
                        <Button size="sm" variant="outline" disabled={pending || !contactValue(open, ch)} onClick={() => logEvent(open, ch, "replied")}>
                          They replied
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive"
                          disabled={pending || !contactValue(open, ch) || contact?.blocked?.[ch] === true}
                          onClick={() => optOut(open, ch)}
                        >
                          {contact?.blocked?.[ch] ? "Opted out" : "Opt out…"}
                        </Button>
                      </div>
                    );
                  })}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>Opt-out reason:</span>
                    <Select value={optReason} onValueChange={setOptReason}>
                      <SelectTrigger aria-label="Opt-out reason" className="h-8 w-[14rem] text-[0.8125rem]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(OPT_OUT_LABELS).map(([v, label]) => (
                          <SelectItem key={v} value={v}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {contact?.loading ? (
                    <p className="text-xs text-muted-foreground">Loading history…</p>
                  ) : contact && contact.log.length > 0 ? (
                    <ul className="flex flex-col gap-1 text-xs">
                      {contact.log.map((l, i) => (
                        <li key={l.id ?? i}>
                          {describeContactEvent(l.channel, l.event)} · {shortDate(l.created_at)}
                          {repName(l.performed_by) ? ` · ${repName(l.performed_by)}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">Nothing logged yet.</p>
                  )}
                </div>
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
                        openProspect(null);
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

type ContactFields = { contact_name: string; contact_role: string; phone: string; email: string; website: string };

/**
 * Type contact details in by hand (e.g. after phoning the school office). Saving replaces the stored
 * contact fields and marks them as confirmed by a person, so no source link is needed.
 */
function ContactEditor({
  prospect,
  pending,
  onSave,
}: {
  prospect: OutboundProspectRow;
  pending: boolean;
  onSave: (fields: ContactFields) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState<ContactFields>({
    contact_name: prospect.contact_name ?? "",
    contact_role: prospect.contact_role ?? "",
    phone: prospect.phone ?? "",
    email: prospect.email ?? "",
    website: prospect.website ?? "",
  });
  const set = (k: keyof ContactFields) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  if (!editing) {
    return (
      <Button className="mt-2" size="sm" variant="outline" onClick={() => setEditing(true)}>
        Edit contacts
      </Button>
    );
  }
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
      <p className="text-xs text-muted-foreground">
        Type what you got from the school (for example by phone). Saving counts as confirmed. Leave a box empty to
        clear it.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="ce-name">Contact name</Label>
          <Input id="ce-name" className="h-8 text-[0.8125rem]" value={f.contact_name} onChange={set("contact_name")} maxLength={200} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ce-role">Role</Label>
          <Input id="ce-role" className="h-8 text-[0.8125rem]" value={f.contact_role} onChange={set("contact_role")} maxLength={100} placeholder="Head teacher, bursar…" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ce-phone">Phone</Label>
          <Input id="ce-phone" className="h-8 text-[0.8125rem]" inputMode="tel" value={f.phone} onChange={set("phone")} maxLength={40} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ce-email">Email</Label>
          <Input id="ce-email" className="h-8 text-[0.8125rem]" inputMode="email" value={f.email} onChange={set("email")} maxLength={254} />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="ce-web">Website</Label>
          <Input id="ce-web" className="h-8 text-[0.8125rem]" value={f.website} onChange={set("website")} maxLength={300} placeholder="school.ac.ke" />
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => onSave(f)}>
          Save contacts
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
