"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { deleteStudentPermanently } from "@/app/(app)/students/[id]/actions";

// Owner/principal only (gated by the students.delete permission server-side — this component
// only renders for someone who already has it, but the RPC re-checks regardless). Requires
// typing the student's full name to confirm, since this cannot be undone: every attendance,
// exam, discipline, health, safeguarding, library, and fee record for this student is purged
// along with the student row itself.
export function StudentDeleteControl({
  studentId,
  fullName,
}: {
  studentId: string;
  fullName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setConfirmName("");
    setReason("");
    setError(null);
    setOpen(true);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    const result = await deleteStudentPermanently(studentId, reason);
    setBusy(false);
    if ("error" in result) return setError(result.error);
    router.push("/students");
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={openDialog}>
        Delete permanently
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permanently delete {fullName}?</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm text-destructive">
              This cannot be undone. Every attendance, exam, discipline, health, safeguarding,
              library, and fee record for this student will be permanently deleted along with
              the student record itself.
            </p>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Type the student&apos;s full name (<span className="font-mono">{fullName}</span>) to confirm
              </label>
              <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reason (optional)</label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Duplicate record created in error"
                rows={2}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={confirm}
              disabled={busy || confirmName.trim() !== fullName.trim()}
            >
              {busy ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
