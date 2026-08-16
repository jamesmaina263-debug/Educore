"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setFeeAlertThresholdAction } from "@/app/(app)/finance/actions";

export function FeeAlertThresholdPanel({
  initialThreshold,
  canWrite,
}: {
  initialThreshold: number | null;
  canWrite: boolean;
}) {
  const [value, setValue] = useState(initialThreshold != null ? String(initialThreshold) : "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      const parsed = value.trim() === "" ? null : Number(value);
      if (parsed !== null && (Number.isNaN(parsed) || parsed < 0)) {
        setMessage("Enter a valid non-negative amount, or leave blank to disable.");
        return;
      }
      const result = await setFeeAlertThresholdAction(parsed);
      if ("error" in result) {
        setMessage(result.error);
        return;
      }
      setMessage("Saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel p-4">
      <p className="mb-1 text-sm font-semibold">Fee arrears alert threshold</p>
      <p className="mb-3 text-sm text-muted-foreground">
        When a student&apos;s fee balance reaches or exceeds this amount, a reminder is drafted
        automatically for Finance to review here in Fee Alerts — it is never sent without someone
        approving it first. Leave blank to turn this off entirely.
      </p>
      <div className="flex items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="fee_alert_threshold">Threshold (KES)</Label>
          <Input
            id="fee_alert_threshold"
            type="number"
            min={0}
            step={100}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!canWrite}
            placeholder="Disabled"
            className="w-40"
          />
        </div>
        {canWrite && (
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
      {message && <p className="mt-2 text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
