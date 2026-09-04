"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  submitCompetencyIndicatorRatings,
  editCompetencyIndicatorRating,
} from "@/app/(app)/academics/competency-appraisal-actions";
import type { BandOption, RosterRatingRow } from "@/lib/academics/competency-appraisal-types";

interface Props {
  indicatorId: string;
  termId: string;
  termClosed: boolean;
  roster: RosterRatingRow[];
  bandOptions: BandOption[];
  canWrite: boolean;
}

export function CompetencyAppraisalGrid({ indicatorId, termId, termClosed, roster, bandOptions, canWrite }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Draft state keyed by student_id -- seeded from existing saved ratings,
  // edited in place, diffed against `roster` on save.
  const [drafts, setDrafts] = useState<Map<string, { band_id: string; observation: string }>>(
    () =>
      new Map(
        roster
          .filter((r) => r.existing)
          .map((r) => [r.student_id, { band_id: r.existing!.band_id, observation: r.existing!.observation ?? "" }]),
      ),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBand, setBulkBand] = useState("");

  function setBand(studentId: string, bandId: string) {
    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(studentId, { band_id: bandId, observation: next.get(studentId)?.observation ?? "" });
      return next;
    });
  }

  function setObservation(studentId: string, text: string) {
    setDrafts((prev) => {
      const next = new Map(prev);
      const current = next.get(studentId);
      if (!current) return prev; // no band picked yet -- nothing to attach an observation to
      next.set(studentId, { ...current, observation: text });
      return next;
    });
  }

  function toggleSelected(studentId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  function toggleSelectAll() {
    // Only students eligible for entry (open term, or already-rated for a
    // closed term) can be bulk-selected -- matches per-row disabled state.
    const eligible = roster.filter((r) => !termClosed || r.existing).map((r) => r.student_id);
    setSelected((prev) => (prev.size === eligible.length ? new Set() : new Set(eligible)));
  }

  function applyBulkBand() {
    if (!bulkBand || selected.size === 0) return;
    setDrafts((prev) => {
      const next = new Map(prev);
      for (const studentId of selected) {
        if (termClosed && !roster.find((r) => r.student_id === studentId)?.existing) continue;
        next.set(studentId, { band_id: bulkBand, observation: next.get(studentId)?.observation ?? "" });
      }
      return next;
    });
  }

  function handleSave() {
    setError(null);
    const toSubmit: { student_id: string; band_id: string; observation: string | null }[] = [];
    const toEdit: { rating_id: string; student_id: string; band_id: string; observation: string | null }[] = [];

    for (const r of roster) {
      const draft = drafts.get(r.student_id);
      if (!draft || !draft.band_id) continue;
      const unchanged = r.existing && r.existing.band_id === draft.band_id && (r.existing.observation ?? "") === draft.observation;
      if (unchanged) continue;

      if (r.existing && termClosed) {
        toEdit.push({ rating_id: r.existing.rating_id, student_id: r.student_id, band_id: draft.band_id, observation: draft.observation || null });
      } else {
        toSubmit.push({ student_id: r.student_id, band_id: draft.band_id, observation: draft.observation || null });
      }
    }

    if (toSubmit.length === 0 && toEdit.length === 0) return;

    startTransition(async () => {
      if (toSubmit.length > 0) {
        const result = await submitCompetencyIndicatorRatings({ indicator_id: indicatorId, term_id: termId, ratings: toSubmit });
        if ("error" in result) return setError(result.error);
      }
      for (const e of toEdit) {
        const reason = window.prompt("This term is closed. Reason for changing this rating?");
        if (!reason) continue;
        const result = await editCompetencyIndicatorRating({ id: e.rating_id, band_id: e.band_id, observation: e.observation, edit_reason: reason });
        if ("error" in result) return setError(result.error);
      }
      router.refresh();
    });
  }

  if (roster.length === 0) {
    return <div className="panel border-dashed p-6 text-center text-sm text-muted-foreground">No active students in this class.</div>;
  }

  const eligibleCount = roster.filter((r) => !termClosed || r.existing).length;

  return (
    <div className="flex flex-col gap-3">
      {termClosed && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
          This term is closed. Only students already rated on this indicator can be changed, and each change needs a reason.
        </p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/30 p-2">
          <span className="text-sm text-muted-foreground">
            {selected.size > 0 ? `${selected.size} selected` : `Select rows to bulk-rate (${eligibleCount} eligible)`}
          </span>
          <Select value={bulkBand} onValueChange={setBulkBand}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Apply rating…" />
            </SelectTrigger>
            <SelectContent>
              {bandOptions.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" disabled={!bulkBand || selected.size === 0} onClick={applyBulkBand}>
            Apply to selected
          </Button>
        </div>
      )}

      <div className="panel overflow-x-auto">
        <Table className="table-dense">
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                {canWrite && <Checkbox checked={selected.size > 0 && selected.size === eligibleCount} onCheckedChange={toggleSelectAll} />}
              </TableHead>
              <TableHead>Student</TableHead>
              <TableHead className="w-48">Rating</TableHead>
              <TableHead>Observation (optional, max 280 chars)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roster.map((r) => {
              const draft = drafts.get(r.student_id);
              const rowDisabled = !canWrite || (termClosed && !r.existing);
              return (
                <TableRow key={r.student_id}>
                  <TableCell>
                    {canWrite && (
                      <Checkbox
                        checked={selected.has(r.student_id)}
                        onCheckedChange={() => toggleSelected(r.student_id)}
                        disabled={rowDisabled}
                      />
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{r.full_name}</TableCell>
                  <TableCell>
                    <Select value={draft?.band_id ?? ""} onValueChange={(v) => setBand(r.student_id, v)} disabled={rowDisabled}>
                      <SelectTrigger className="w-44">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {bandOptions.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Textarea
                      value={draft?.observation ?? ""}
                      onChange={(e) => setObservation(r.student_id, e.target.value.slice(0, 280))}
                      disabled={rowDisabled || !draft?.band_id}
                      maxLength={280}
                      rows={1}
                      className="min-h-0 py-1.5"
                      placeholder={draft?.band_id ? "Optional note…" : "Pick a rating first"}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {canWrite && (
        <Button disabled={pending} onClick={handleSave} className="w-fit">
          {pending ? "Saving…" : "Save ratings"}
        </Button>
      )}
    </div>
  );
}
