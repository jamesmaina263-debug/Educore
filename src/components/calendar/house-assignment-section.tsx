"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { assignLearnersAction } from "@/app/(app)/calendar/actions";
import { MAX_ASSIGN_BATCH, NO_HOUSE, filterLearners, houseCounts, type LearnerRow } from "@/lib/school-calendar";
import type { HouseRow } from "@/components/calendar/calendar-section";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

const PAGE_SIZE = 100;

export function HouseAssignmentSection({
  learners,
  houses,
  canWrite,
}: {
  learners: LearnerRow[];
  houses: HouseRow[];
  canWrite: boolean;
}) {
  const [search, setSearch] = useState("");
  const [classKey, setClassKey] = useState("");
  const [houseFilter, setHouseFilter] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const houseById = new Map(houses.map((h) => [h.id, h]));
  const activeHouses = houses.filter((h) => h.status === "active");
  const counts = houseCounts(learners);

  const classOptions = Array.from(new Map(learners.filter((l) => l.classKey).map((l) => [l.classKey, l.classLabel])).entries()).sort((a, b) =>
    a[1].localeCompare(b[1]),
  );

  const filtered = filterLearners(learners, { search, classKey, house: houseFilter });
  const shown = filtered.slice(0, limit);
  const allShownSelected = shown.length > 0 && shown.every((l) => selected.has(l.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleShown() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allShownSelected) shown.forEach((l) => next.delete(l.id));
      else shown.forEach((l) => next.add(l.id));
      return next;
    });
  }

  async function apply(houseId: string | null) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await assignLearnersAction(Array.from(selected), houseId);
      if ("error" in result) {
        setError(result.error);
      } else {
        const what = houseId ? `moved to ${houseById.get(houseId)?.name ?? "the house"}` : "removed from their house";
        setNotice(
          result.failed > 0
            ? `${result.done} learner(s) ${what}; ${result.failed} could not be updated.`
            : `${result.done} learner(s) ${what}.`,
        );
        setSelected(new Set());
      }
    } finally {
      setBusy(false);
    }
  }

  if (houses.length === 0) {
    return <p className="panel p-4 text-sm text-muted-foreground">Add at least one house on the Calendar page first.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      {notice && <p className="rounded-md border p-2 text-sm text-muted-foreground">{notice}</p>}

      <div className="panel flex flex-wrap gap-3 p-4">
        {houses.map((h) => (
          <div key={h.id} className="flex items-center gap-2 text-sm">
            <span aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: h.colour }} />
            <span className={h.status === "archived" ? "text-muted-foreground line-through" : ""}>{h.name}</span>
            <span className="text-muted-foreground">{counts.get(h.id) ?? 0}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">No house</span>
          <span className="text-muted-foreground">{counts.get(NO_HOUSE) ?? 0}</span>
        </div>
      </div>

      <div className="panel flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="la-search">Search</Label>
            <Input id="la-search" className="w-52" placeholder="Name or admission no." value={search} onChange={(e) => { setSearch(e.target.value); setLimit(PAGE_SIZE); }} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="la-class">Class</Label>
            <select id="la-class" className={selectClass} value={classKey} onChange={(e) => { setClassKey(e.target.value); setLimit(PAGE_SIZE); }}>
              <option value="">All classes</option>
              {classOptions.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="la-house">House</Label>
            <select id="la-house" className={selectClass} value={houseFilter} onChange={(e) => { setHouseFilter(e.target.value); setLimit(PAGE_SIZE); }}>
              <option value="">Any</option>
              <option value={NO_HOUSE}>No house yet</option>
              {houses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {canWrite && (
          <div className="flex flex-wrap items-end gap-3 border-t pt-3">
            <p className="text-sm text-muted-foreground">{selected.size} selected</p>
            <div className="flex flex-col gap-1">
              <Label htmlFor="la-target">Move selected to</Label>
              <select id="la-target" className={selectClass} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Choose a house</option>
                {activeHouses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
            <Button disabled={busy || selected.size === 0 || !target || selected.size > MAX_ASSIGN_BATCH} onClick={() => apply(target)}>
              {busy ? "Saving..." : "Move"}
            </Button>
            <Button variant="outline" disabled={busy || selected.size === 0 || selected.size > MAX_ASSIGN_BATCH} onClick={() => apply(null)}>
              Remove from house
            </Button>
            {selected.size > MAX_ASSIGN_BATCH && (
              <p className="text-xs text-destructive">Select at most {MAX_ASSIGN_BATCH} learners at a time.</p>
            )}
            {selected.size > 0 && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setSelected(new Set())}>
                Clear selection
              </Button>
            )}
          </div>
        )}

        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No learners match.</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  {canWrite && (
                    <th className="w-8 py-1">
                      <input type="checkbox" aria-label="Select all shown" checked={allShownSelected} onChange={toggleShown} />
                    </th>
                  )}
                  <th className="py-1">Learner</th>
                  <th className="py-1">Class</th>
                  <th className="py-1">House</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => {
                  const h = l.houseId ? houseById.get(l.houseId) : null;
                  return (
                    <tr key={l.id} className="border-b last:border-0">
                      {canWrite && (
                        <td className="py-1.5">
                          <input type="checkbox" aria-label={`Select ${l.name}`} checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
                        </td>
                      )}
                      <td className="py-1.5">
                        {l.name}
                        {l.admissionNumber && <span className="ml-2 text-xs text-muted-foreground">{l.admissionNumber}</span>}
                      </td>
                      <td className="py-1.5 text-muted-foreground">{l.classLabel}</td>
                      <td className="py-1.5">
                        {h ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: h.colour }} />
                            {h.name}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">None</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Showing {shown.length} of {filtered.length}
              </span>
              {filtered.length > shown.length && (
                <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                  Show more
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
