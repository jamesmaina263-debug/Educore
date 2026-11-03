"use client";

import { useState } from "react";
import Link from "next/link";
import { useSchoolHref } from "@/components/app-shell/school-slug-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { saveEventAction, cancelEventAction, saveHouseAction } from "@/app/(app)/calendar/actions";
import {
  CATEGORY_LABELS,
  EVENT_CATEGORIES,
  formatDateRange,
  formatTimeRange,
  groupByMonth,
  splitUpcoming,
  type CalendarEvent,
  type EventAudience,
  type EventCategory,
  type EventInput,
} from "@/lib/school-calendar";

export interface HouseRow {
  id: string;
  name: string;
  colour: string;
  status: "active" | "archived";
}

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

const EMPTY_EVENT = (today: string): EventInput => ({
  id: null,
  title: "",
  description: "",
  category: "other",
  startsOn: today,
  endsOn: today,
  startTime: "",
  endTime: "",
  location: "",
  houseId: null,
  audience: "everyone",
});

export function CalendarSection({
  events,
  houses,
  canWrite,
  today,
}: {
  events: CalendarEvent[];
  houses: HouseRow[];
  canWrite: boolean;
  today: string;
}) {
  const toHref = useSchoolHref();
  const [form, setForm] = useState<EventInput | null>(null);
  const [houseName, setHouseName] = useState("");
  const [houseColour, setHouseColour] = useState("#2563eb");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const houseById = new Map(houses.map((h) => [h.id, h]));
  const activeHouses = houses.filter((h) => h.status === "active");
  const { upcoming, past } = splitUpcoming(events, today);
  const shown = showPast ? [...upcoming, ...past] : upcoming;

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

  function edit(e: CalendarEvent) {
    setForm({
      id: e.id,
      title: e.title,
      description: e.description ?? "",
      category: e.category,
      startsOn: e.startsOn,
      endsOn: e.endsOn,
      startTime: e.startTime ? e.startTime.slice(0, 5) : "",
      endTime: e.endTime ? e.endTime.slice(0, 5) : "",
      location: e.location ?? "",
      houseId: e.houseId,
      audience: e.audience,
    });
    setError(null);
    setNotice(null);
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      {notice && <p className="rounded-md border p-2 text-sm text-muted-foreground">{notice}</p>}

      {canWrite && (
        <div className="panel p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">{form ? (form.id ? "Edit event" : "New event") : "Events"}</p>
            {!form && (
              <Button size="sm" onClick={() => setForm(EMPTY_EVENT(today))}>
                Add event
              </Button>
            )}
          </div>
          {form && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1 sm:col-span-2">
                <Label htmlFor="ev-title">Title</Label>
                <Input id="ev-title" value={form.title} maxLength={150} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="ev-cat">Category</Label>
                <select id="ev-cat" className={selectClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as EventCategory })}>
                  {EVENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="ev-aud">Who can see it</Label>
                <select id="ev-aud" className={selectClass} value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value as EventAudience })}>
                  <option value="everyone">Everyone (staff and parents)</option>
                  <option value="staff_only">Staff only</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="ev-start">Starts</Label>
                <Input id="ev-start" type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value, endsOn: form.endsOn < e.target.value ? e.target.value : form.endsOn })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="ev-end">Ends</Label>
                <Input id="ev-end" type="date" value={form.endsOn} min={form.startsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="ev-st">Start time (optional)</Label>
                <Input id="ev-st" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value, endTime: e.target.value ? form.endTime : "" })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="ev-et">End time (optional)</Label>
                <Input id="ev-et" type="time" value={form.endTime} disabled={!form.startTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="ev-loc">Location (optional)</Label>
                <Input id="ev-loc" value={form.location} maxLength={150} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="ev-house">House (optional)</Label>
                <select id="ev-house" className={selectClass} value={form.houseId ?? ""} onChange={(e) => setForm({ ...form, houseId: e.target.value || null })}>
                  <option value="">Whole school</option>
                  {activeHouses.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <Label htmlFor="ev-desc">Description (optional)</Label>
                <Textarea id="ev-desc" rows={3} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <Button
                  disabled={busy}
                  onClick={() => run(() => saveEventAction(form), "Event saved.", () => setForm(null))}
                >
                  {busy ? "Saving..." : "Save event"}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setForm(null)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold">{showPast ? "All events" : "Upcoming events"}</p>
          {past.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setShowPast((v) => !v)}>
              {showPast ? "Hide past events" : `Show ${past.length} past`}
            </Button>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        ) : (
          groupByMonth(shown).map((g) => (
            <div key={g.month} className="mb-4 last:mb-0">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.month}</p>
              <ul className="flex flex-col divide-y">
                {g.events.map((e) => {
                  const house = e.houseId ? houseById.get(e.houseId) : null;
                  const time = formatTimeRange(e.startTime, e.endTime);
                  const cancelled = e.status === "cancelled";
                  return (
                    <li key={e.id} className="flex flex-col gap-1 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-sm font-medium ${cancelled ? "line-through text-muted-foreground" : ""}`}>{e.title}</span>
                        <StatusBadge tone={cancelled ? "danger" : "neutral"} label={cancelled ? "Cancelled" : CATEGORY_LABELS[e.category]} />
                        {e.audience === "staff_only" && <StatusBadge tone="info" label="Staff only" />}
                        {house && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: house.colour }} />
                            {house.name}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDateRange(e.startsOn, e.endsOn)}
                        {time ? `, ${time}` : ""}
                        {e.location ? `, ${e.location}` : ""}
                      </p>
                      {e.description && <p className="text-sm">{e.description}</p>}
                      {cancelled && e.cancelReason && <p className="text-xs text-muted-foreground">Reason: {e.cancelReason}</p>}
                      {canWrite && !cancelled && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button variant="outline" size="sm" disabled={busy} onClick={() => edit(e)}>
                            Edit
                          </Button>
                          {cancelId === e.id ? (
                            <>
                              <Input className="h-8 w-56" placeholder="Reason (optional)" value={cancelReason} maxLength={500} onChange={(ev) => setCancelReason(ev.target.value)} />
                              <Button
                                variant="destructive"
                                size="sm"
                                disabled={busy}
                                onClick={() => run(() => cancelEventAction(e.id, cancelReason), "Event cancelled.", () => { setCancelId(null); setCancelReason(""); })}
                              >
                                Confirm cancel
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => setCancelId(null)}>
                                Keep event
                              </Button>
                            </>
                          ) : (
                            <Button variant="outline" size="sm" disabled={busy} onClick={() => { setCancelId(e.id); setCancelReason(""); }}>
                              Cancel event
                            </Button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="panel p-4">
        <p className="mb-1 text-sm font-semibold">Houses</p>
        <p className="mb-3 text-sm text-muted-foreground">Competition houses (for example Red House). These are separate from boarding houses.</p>
        {houses.length > 0 && (
          <Link href={toHref("/calendar/houses")} className="mb-3 inline-block text-sm font-medium underline underline-offset-2">
            {canWrite ? "Assign learners to houses" : "See which learners are in each house"}
          </Link>
        )}
        {houses.length === 0 ? (
          <p className="mb-3 text-sm text-muted-foreground">No houses yet.</p>
        ) : (
          <ul className="mb-3 flex flex-wrap gap-2">
            {houses.map((h) => (
              <li key={h.id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                <span aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: h.colour }} />
                <span className={h.status === "archived" ? "text-muted-foreground line-through" : ""}>{h.name}</span>
                {canWrite && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => saveHouseAction({ id: h.id, name: h.name, colour: h.colour, status: h.status === "active" ? "archived" : "active" }),
                        h.status === "active" ? "House archived." : "House restored.",
                      )
                    }
                  >
                    {h.status === "active" ? "Archive" : "Restore"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canWrite && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="house-name">New house</Label>
              <Input id="house-name" className="w-48" value={houseName} maxLength={60} onChange={(e) => setHouseName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="house-colour">Colour</Label>
              <input id="house-colour" type="color" className="h-9 w-12 rounded-md border border-input bg-background" value={houseColour} onChange={(e) => setHouseColour(e.target.value)} />
            </div>
            <Button
              disabled={busy || !houseName.trim()}
              onClick={() => run(() => saveHouseAction({ id: null, name: houseName, colour: houseColour, status: "active" }), "House added.", () => setHouseName(""))}
            >
              Add house
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
