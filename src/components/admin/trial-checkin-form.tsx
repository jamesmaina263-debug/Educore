"use client";

import { useState, useTransition } from "react";
import { logTrialCheckin } from "@/app/(admin)/admin/trials/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CHANNEL_LABELS,
  CHECKIN_CHANNELS,
  CHECKIN_OUTCOMES,
  OUTCOME_LABELS,
  isCheckinChannel,
  isCheckinOutcome,
  type CheckinChannel,
  type CheckinOutcome,
} from "@/lib/growth/trial-checkins";

// Inline "Log check-in" form for one trial school. Self-reported: it records what a person says they did.
// Nothing is sent from here and no subscription is changed.

const NOT_STATED = "none";

export function TrialCheckinForm({
  schoolId,
  teamMembers,
}: {
  schoolId: string;
  teamMembers: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<CheckinChannel>("call");
  const [outcome, setOutcome] = useState<CheckinOutcome>("reached_interested");
  const [by, setBy] = useState(NOT_STATED);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await logTrialCheckin(schoolId, channel, outcome, by === NOT_STATED ? null : by, note);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setNote("");
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Log check-in
      </Button>
    );
  }

  return (
    <div className="flex min-w-[14rem] flex-col gap-2 text-xs">
      <div className="flex flex-col gap-1">
        <Label>How</Label>
        <Select value={channel} onValueChange={(v) => isCheckinChannel(v) && setChannel(v)}>
          <SelectTrigger aria-label="How you checked in" className="h-8 text-[0.8125rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHECKIN_CHANNELS.map((c) => (
              <SelectItem key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label>Outcome</Label>
        <Select value={outcome} onValueChange={(v) => isCheckinOutcome(v) && setOutcome(v)}>
          <SelectTrigger aria-label="Outcome" className="h-8 text-[0.8125rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHECKIN_OUTCOMES.map((o) => (
              <SelectItem key={o} value={o}>
                {OUTCOME_LABELS[o]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label>Who</Label>
        <Select value={by} onValueChange={setBy}>
          <SelectTrigger aria-label="Who checked in" className="h-8 text-[0.8125rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NOT_STATED}>Not stated</SelectItem>
            {teamMembers.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label>Note (optional)</Label>
        <Textarea
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Keep it short. No learner details."
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={submit}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-destructive">{error}</p>}
    </div>
  );
}
