"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createInvoiceAction } from "@/app/(admin)/admin/billing/invoices/actions";

// Manual invoice for any period (e.g. a mid-term start or a one-off). The automated end-of-term
// run lives in Billing settings; both go through the same SQL, so numbering, duplicate/overlap
// protection and the snapshot rules are identical.
export function AdminCreateInvoiceDialog({ schools }: { schools: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [schoolId, setSchoolId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [label, setLabel] = useState("");
  const [asDraft, setAsDraft] = useState(true);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createInvoiceAction({ schoolId, periodStart: start, periodEnd: end, asDraft, label });
      if ("error" in res) return setError(res.error);
      setOpen(false);
      router.push(`/admin/billing/invoices/${res.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Create invoice</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create invoice</DialogTitle>
          <DialogDescription>
            The student count and rate are taken from the school&apos;s current subscription and the billing rules, and are recorded on the invoice.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ci-school">School</Label>
            <select id="ci-school" value={schoolId} onChange={(e) => setSchoolId(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
              <option value="">Select a school…</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ci-start">Period start</Label>
              <Input id="ci-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ci-end">Period end</Label>
              <Input id="ci-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ci-label">Period label (optional)</Label>
            <Input id="ci-label" placeholder="e.g. Term 3 2026" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
            <p className="text-xs text-muted-foreground">Shown on the invoice. Defaults to the dates.</p>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={asDraft} onChange={(e) => setAsDraft(e.target.checked)} className="mt-0.5" />
            <span>
              Save as a draft for review first
              <span className="block text-xs text-muted-foreground">Drafts are invisible to the school and never become overdue. Untick to issue immediately.</span>
            </span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !schoolId || !start || !end}>
            {pending ? "Creating…" : asDraft ? "Create draft" : "Create & issue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
