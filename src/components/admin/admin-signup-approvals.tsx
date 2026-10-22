"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { reviewSchoolSignup } from "@/app/(admin)/admin/signups/actions";
import { isChildrenHome } from "@/lib/outbound/children-home";

export type SignupRow = {
  id: string;
  name: string;
  kind: string | null;
  created_at: string;
  status: "pending" | "approved" | "rejected";
  reviewed_at: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
};

function SchoolCell({ row }: { row: SignupRow }) {
  return (
    <div className="min-w-0">
      <div className="font-medium">{row.name}</div>
      <div className="text-xs text-muted-foreground">
        {row.kind ? `${row.kind} · ` : ""}signed up {new Date(row.created_at).toLocaleString()}
      </div>
    </div>
  );
}

function OwnerCell({ row }: { row: SignupRow }) {
  return (
    <div className="min-w-0 text-sm">
      <div>{row.owner_name ?? "—"}</div>
      <div className="break-all text-xs text-muted-foreground">{row.owner_email ?? "—"}</div>
      <div className="text-xs text-muted-foreground">{row.owner_phone ?? ""}</div>
    </div>
  );
}

// EduCore's outreach tells children's homes it will not charge them, and a new signup only gets a normal 30-day
// trial. So a signup whose NAME looks like a children's home needs a person to verify it and, if genuine, mark it
// complimentary in Billing before the trial ends. This is a prompt only: the name is never proof (anyone can type
// any school name at signup) and nothing here changes billing.
function ChildrensHomeNotice({ approved }: { approved: boolean }) {
  return (
    <p className="rounded-md border border-warning/25 bg-warning-subtle p-2 text-xs text-warning">
      <strong>Looks like a children&apos;s home.</strong>{" "}
      {approved
        ? "If it is genuine, mark it complimentary in "
        : "Check it is genuine before approving. If it is, approve it, then mark it complimentary in "}
      <Link href="/admin/billing" className="underline">
        Billing
      </Link>{" "}
      before its 30-day trial ends, or it will be suspended even though our outreach says we do not charge children&apos;s
      homes.
    </p>
  );
}

export function AdminSignupApprovals({ rows }: { rows: SignupRow[] }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<SignupRow | null>(null);

  const waiting = rows.filter((r) => r.status === "pending");
  const rejected = rows.filter((r) => r.status === "rejected");
  const recent = rows.filter((r) => r.status === "approved" && r.reviewed_at).slice(0, 10);

  function decide(id: string, decision: "approved" | "rejected") {
    setError(null);
    startTransition(async () => {
      const res = await reviewSchoolSignup(id, decision);
      if ("error" in res) setError(res.error);
      else {
        setRejectTarget(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p role="alert" className="rounded-md border border-destructive/25 bg-destructive-subtle p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Waiting for approval ({waiting.length})</h2>
        {waiting.length === 0 ? (
          <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
            Nothing is waiting. New signups will appear here, and you will get a notification and an email.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {waiting.map((row) => (
              <li key={row.id} className="flex flex-col gap-3 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="grid flex-1 gap-3 sm:grid-cols-2">
                    <SchoolCell row={row} />
                    <OwnerCell row={row} />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" disabled={busy} onClick={() => decide(row.id, "approved")}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejectTarget(row)}>
                      Reject
                    </Button>
                  </div>
                </div>
                {isChildrenHome(row.name) ? <ChildrensHomeNotice approved={false} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {rejected.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Rejected ({rejected.length})</h2>
          <ul className="divide-y divide-border rounded-md border border-border">
            {rejected.map((row) => (
              <li key={row.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="grid flex-1 gap-3 sm:grid-cols-2">
                  <SchoolCell row={row} />
                  <OwnerCell row={row} />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge tone="danger" label="Not approved" />
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => decide(row.id, "approved")}>
                    Approve instead
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Recently approved</h2>
          <ul className="divide-y divide-border rounded-md border border-border">
            {recent.map((row) => (
              <li key={row.id} className="flex flex-col gap-3 p-3">
                <div className="flex items-center justify-between gap-3">
                  <SchoolCell row={row} />
                  <StatusBadge
                    tone="success"
                    label={`Approved ${row.reviewed_at ? new Date(row.reviewed_at).toLocaleDateString() : ""}`.trim()}
                  />
                </div>
                {isChildrenHome(row.name) ? <ChildrensHomeNotice approved /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Dialog open={rejectTarget !== null} onOpenChange={(open) => (!open ? setRejectTarget(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {rejectTarget?.name}?</DialogTitle>
            <DialogDescription>
              Its staff will be signed out with a &ldquo;signup not approved&rdquo; message. The school and its data are
              kept, and you can approve it later from the Rejected list.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setRejectTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => rejectTarget && decide(rejectTarget.id, "rejected")}
            >
              Reject signup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
