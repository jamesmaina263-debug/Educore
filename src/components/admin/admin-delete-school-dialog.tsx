"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  deleteSchoolPermanently,
  previewSchoolDeletion,
  type SchoolDeletionPreview,
  type SchoolDeletionSummary,
} from "@/app/(admin)/admin/actions";

export interface DeletableSchool {
  id: string;
  name: string;
  slug: string;
}

/**
 * Whether the destructive button may be enabled. Kept pure and exported so the rule is tested directly.
 * The slug must match EXACTLY (case and all): it is the "type the name to confirm" speed bump.
 */
export function deletionReady(args: {
  preview: SchoolDeletionPreview | null;
  typedSlug: string;
  reason: string;
  eraseBilling: boolean;
}): boolean {
  const { preview, typedSlug, reason, eraseBilling } = args;
  if (!preview || !preview.can_delete) return false;
  if (typedSlug.trim() !== preview.slug) return false;
  if (reason.trim().length < 3) return false;
  if (preview.paid_payments > 0 && !eraseBilling) return false;
  return true;
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;

type DialogProps = {
  onClose: () => void;
  /** Called after a successful deletion, once the person has dismissed the result. */
  onDeleted: () => void;
};

/** Mounted per school (keyed by id) so every state field starts fresh -- no reset logic to get wrong. */
export function AdminDeleteSchoolDialog({ school, ...rest }: DialogProps & { school: DeletableSchool | null }) {
  if (!school) return null;
  return <DeleteSchoolDialogBody key={school.id} school={school} {...rest} />;
}

function DeleteSchoolDialogBody({ school, onClose, onDeleted }: DialogProps & { school: DeletableSchool }) {
  const [preview, setPreview] = useState<SchoolDeletionPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [typedSlug, setTypedSlug] = useState("");
  const [eraseBilling, setEraseBilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SchoolDeletionSummary | null>(null);
  const [pending, startTransition] = useTransition();

  const schoolId = school.id;

  useEffect(() => {
    let cancelled = false;
    previewSchoolDeletion(schoolId).then((res) => {
      if (cancelled) return;
      if ("error" in res) setLoadError(res.error);
      else setPreview(res.preview);
    });
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await deleteSchoolPermanently({
        schoolId: school.id,
        confirmSlug: typedSlug,
        reason,
        eraseBilling,
      });
      if ("error" in res) setError(res.error);
      else setSummary(res.summary);
    });
  }

  function dismiss() {
    const wasDeleted = summary !== null;
    onClose();
    if (wasDeleted) onDeleted();
  }

  const ready = deletionReady({ preview, typedSlug, reason, eraseBilling });

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && dismiss()}>
      <DialogContent>
        {summary ? (
          <>
            <DialogHeader>
              <DialogTitle>{summary.schoolName || school.name} was deleted</DialogTitle>
              <DialogDescription>
                {summary.rowsDeleted.toLocaleString()} records erased ({summary.studentsDeleted} students,{" "}
                {summary.staffDeleted} staff), {summary.filesRemoved} files and {summary.accountsRemoved} login
                accounts removed. A record of this is in the activity log.
              </DialogDescription>
            </DialogHeader>
            {summary.warnings.length > 0 && (
              <div role="alert" className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">The school is gone, but some clean-up needs a person:</p>
                <ul className="list-disc pl-5">
                  {summary.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            <DialogFooter>
              <Button onClick={dismiss}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="size-5" aria-hidden /> Permanently delete {school.name}
              </DialogTitle>
              <DialogDescription>
                This cannot be undone and there is no backup to restore from here. Every student, staff member,
                parent, fee, payment, mark, report, file and login account belonging to this school is erased.
                Other schools are not touched.
              </DialogDescription>
            </DialogHeader>

            {loadError && (
              <p role="alert" className="text-sm text-destructive">
                {loadError}
              </p>
            )}
            {!preview && !loadError && <p className="text-sm text-muted-foreground">Checking what would be erased…</p>}

            {preview && (
              <div className="space-y-3">
                <ul className="rounded-md border bg-muted/40 p-3 text-sm">
                  <li>{preview.students.toLocaleString()} students</li>
                  <li>{preview.staff.toLocaleString()} staff</li>
                  <li>{preview.login_accounts.toLocaleString()} login accounts (staff, parents, students)</li>
                  <li>{preview.platform_invoices.toLocaleString()} subscription invoices</li>
                </ul>

                {preview.blockers.length > 0 && (
                  <div role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                    {preview.blockers.map((b) => (
                      <p key={b}>{b}</p>
                    ))}
                  </div>
                )}

                {preview.paid_payments > 0 && (
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      id="erase-billing"
                      checked={eraseBilling}
                      onCheckedChange={(c) => setEraseBilling(c === true)}
                      className="mt-0.5"
                    />
                    <span>
                      Also erase {preview.paid_payments} recorded subscription payment
                      {preview.paid_payments === 1 ? "" : "s"} totalling {kes(preview.paid_kes)}. This is real
                      revenue history; only tick this if it should not be kept.
                    </span>
                  </label>
                )}

                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Reason (kept in the activity log)</p>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Duplicate trial signup, owner asked us to remove all data"
                    rows={2}
                    maxLength={300}
                  />
                </div>

                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Type <span className="font-mono font-semibold text-foreground">{preview.slug}</span> to confirm
                  </p>
                  <Input
                    value={typedSlug}
                    onChange={(e) => setTypedSlug(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    aria-label="Type the school slug to confirm"
                  />
                </div>
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={dismiss} disabled={pending}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={confirm} disabled={!ready || pending}>
                {pending ? "Deleting…" : "Delete permanently"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
