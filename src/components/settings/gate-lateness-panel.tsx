"use client";

// Editor for schools.gate_late_after_student / gate_late_after_staff --
// both nullable, both default unset (meaning "no lateness distinction",
// biometric-verify's original always-'present' behavior). Writes go
// through update_gate_late_thresholds(), gated on biometric.devices_manage
// server-side -- see that RPC's own comment for why this isn't a direct
// update on `schools` (its blanket RLS write policy checks a different,
// broader permission).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type UpdateResult = { error: string } | { success: true };

/** Postgres `time` -> the "HH:MM" an <input type="time"> expects. */
function toInputValue(time: string | null): string {
  return time ? time.slice(0, 5) : "";
}

export function GateLatenessPanel({
  initial,
  canManage,
  updateAction,
}: {
  initial: { late_after_student: string | null; late_after_staff: string | null };
  canManage: boolean;
  updateAction: (input: { late_after_student: string | null; late_after_staff: string | null }) => Promise<UpdateResult>;
}) {
  const router = useRouter();
  const [lateAfterStudent, setLateAfterStudent] = useState(toInputValue(initial.late_after_student));
  const [lateAfterStaff, setLateAfterStaff] = useState(toInputValue(initial.late_after_staff));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const result = await updateAction({
      late_after_student: lateAfterStudent || null,
      late_after_staff: lateAfterStaff || null,
    });
    setSaving(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-4 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-medium">Gate lateness cutoff</h3>
        <p className="text-xs text-muted-foreground">
          A biometric gate check-in after this time is marked <span className="font-medium">late</span> instead of{" "}
          <span className="font-medium">present</span>. Leave blank to keep every gate check-in marked present, same as today.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="late_after_student">Students</Label>
          <Input
            id="late_after_student"
            type="time"
            value={lateAfterStudent}
            onChange={(e) => setLateAfterStudent(e.target.value)}
            disabled={!canManage}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="late_after_staff">Staff</Label>
          <Input
            id="late_after_staff"
            type="time"
            value={lateAfterStaff}
            onChange={(e) => setLateAfterStaff(e.target.value)}
            disabled={!canManage}
          />
        </div>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {canManage && (
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {saved && !error && <span className="text-xs text-muted-foreground">Saved.</span>}
        </div>
      )}
    </div>
  );
}
