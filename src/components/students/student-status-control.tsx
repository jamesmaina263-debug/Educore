"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { updateStudentStatus, type StudentStatus } from "@/app/(app)/students/[id]/actions";

const STATUS_OPTIONS: { value: StudentStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "transferred", label: "Transferred" },
  { value: "graduated", label: "Graduated" },
];

const LEAVING_STATUSES = new Set<StudentStatus>(["withdrawn", "transferred", "graduated"]);

export function StudentStatusControl({
  studentId,
  currentStatus,
}: {
  studentId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nextStatus, setNextStatus] = useState<StudentStatus>(
    currentStatus === "active" ? "withdrawn" : "active",
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReactivating = nextStatus === "active";
  const isCascading = LEAVING_STATUSES.has(nextStatus);

  function openDialog() {
    setNextStatus(currentStatus === "active" ? "withdrawn" : "active");
    setReason("");
    setError(null);
    setOpen(true);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    const result = await updateStudentStatus(studentId, nextStatus, reason);
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog}>
        Change status
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change student status</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">New status</label>
              <Select value={nextStatus} onValueChange={(v) => setNextStatus(v as StudentStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.filter((o) => o.value !== currentStatus).map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isCascading && (
              <p className="text-xs text-muted-foreground">
                Any active transport assignment or boarding allocation for this student will be
                ended automatically.
              </p>
            )}
            {isReactivating && (
              <p className="text-xs text-muted-foreground">
                Reactivating does not restore any previous transport or boarding assignment —
                those are re-added separately if still needed.
              </p>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reason (optional)</label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Family relocated to Mombasa"
                rows={3}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={confirm} disabled={busy}>
              {busy ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
