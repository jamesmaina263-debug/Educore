"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { updateStudentNemisIdentifiers } from "@/app/(app)/students/[id]/actions";

type NemisSyncStatus = "not_submitted" | "included_in_batch" | "confirmed_synced";

const STATUS_LABEL: Record<NemisSyncStatus, { label: string; tone: "neutral" | "warning" | "success" }> = {
  not_submitted: { label: "Not submitted", tone: "neutral" },
  included_in_batch: { label: "In a pending batch", tone: "warning" },
  confirmed_synced: { label: "Confirmed synced", tone: "success" },
};

export function NemisIdentifiersCard({
  studentId,
  upiNumber,
  birthCertificateNumber,
  syncStatus,
  syncedAt,
  notes,
  canManage,
}: {
  studentId: string;
  upiNumber: string | null;
  birthCertificateNumber: string | null;
  syncStatus: NemisSyncStatus;
  syncedAt: string | null;
  notes: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [upi, setUpi] = useState(upiNumber ?? "");
  const [birthCert, setBirthCert] = useState(birthCertificateNumber ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setPending(true);
    setError(null);
    const result = await updateStudentNemisIdentifiers(studentId, {
      upi_number: upi,
      birth_certificate_number: birthCert,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    router.refresh();
  }

  const status = STATUS_LABEL[syncStatus];

  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <p className="label-eyebrow">NEMIS</p>
        <StatusBadge tone={status.tone} label={status.label} />
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">UPI number</dt>
          <dd>{upiNumber || "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Birth certificate no.</dt>
          <dd>{birthCertificateNumber || "—"}</dd>
        </div>
        {syncedAt && (
          <div className="col-span-2">
            <dt className="text-muted-foreground">Confirmed synced</dt>
            <dd>{new Date(syncedAt).toLocaleDateString()}</dd>
          </div>
        )}
        {notes && (
          <div className="col-span-2">
            <dt className="text-muted-foreground">Notes</dt>
            <dd className="text-warning">{notes}</dd>
          </div>
        )}
      </dl>

      {canManage && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="self-start">
              Edit identifiers
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit NEMIS identifiers</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="upi_number">UPI number</Label>
                <Input id="upi_number" value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="e.g. 12A3456789" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="birth_cert">Birth certificate number</Label>
                <Input
                  id="birth_cert"
                  value={birthCert}
                  onChange={(e) => setBirthCert(e.target.value)}
                  placeholder="e.g. 1234567"
                />
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}
            </div>
            <DialogFooter>
              <Button onClick={handleSave} disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
