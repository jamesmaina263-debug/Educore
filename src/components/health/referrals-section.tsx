"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { createReferral, updateReferralOutcome } from "@/app/(app)/health/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { StudentCombobox } from "@/components/shared/student-combobox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useServerTableParams } from "@/hooks/use-server-table-params";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { queueMutation } from "@/lib/offline/queue";
import { HealthOfflineBanner } from "./offline-banner";
import type { StudentOption } from "./student-picker";

export interface ReferralRow {
  id: string;
  student_name: string;
  referred_to: string;
  reason: string;
  referral_date: string;
  status: "pending" | "completed" | "cancelled";
  guardian_notified: boolean;
  outcome_notes: string | null;
}

/**
 * `referrals` arrives already paginated/searched server-side (see
 * getReferralsPage) -- same useServerTableParams pattern used elsewhere
 * in this module. Doesn't touch loadHealthContext.
 */
function ReferralsSectionInner({
  referrals,
  totalCount,
  pageSize,
  studentOptions,
  canWrite,
}: {
  referrals: ReferralRow[];
  totalCount: number;
  pageSize: number;
  studentOptions: StudentOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const { pageIndex, pageCount, onPageChange, search, onSearchChange } = useServerTableParams({
    totalCount,
    pageSize,
  });
  const page = pageIndex + 1;
  const { online, pendingCount, failed, syncing, sync, discard } = useOfflineSync("health");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [form, setForm] = useState({
    student_id: "",
    referred_to: "",
    reason: "",
    referral_date: new Date().toISOString().slice(0, 10),
    guardian_notified: false,
  });

  async function submit() {
    if (!form.student_id || !form.referred_to || !form.reason) {
      setError("Student, referred to, and reason are required.");
      return;
    }
    setPending(true);
    setError(null);
    // Generated once here so a queued-then-replayed retry (lost ack after the original
    // request actually landed) reuses the same key instead of creating a second referral
    // for the same incident -- same pattern as medication-section.tsx.
    const clientMutationId = crypto.randomUUID();
    const input = { ...form, client_mutation_id: clientMutationId };
    if (!online) {
      await queueMutation("health", "createReferral", input);
      setPending(false);
      setOpen(false);
      setForm({ student_id: "", referred_to: "", reason: "", referral_date: new Date().toISOString().slice(0, 10), guardian_notified: false });
      return;
    }
    const result = await createReferral(input);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setForm({ student_id: "", referred_to: "", reason: "", referral_date: new Date().toISOString().slice(0, 10), guardian_notified: false });
    router.refresh();
  }

  async function resolve(id: string, status: "completed" | "cancelled") {
    setPending(true);
    await updateReferralOutcome(id, status, outcomeNotes || undefined);
    setPending(false);
    setResolvingId(null);
    setOutcomeNotes("");
    router.refresh();
  }

  const statusTone: Record<ReferralRow["status"], "success" | "danger" | "neutral"> = {
    pending: "neutral",
    completed: "success",
    cancelled: "danger",
  };

  return (
    <div className="flex flex-col gap-4">
      <HealthOfflineBanner online={online} pendingCount={pendingCount} failed={failed} syncing={syncing} sync={sync} discard={discard} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {canWrite && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="self-start">
              New referral
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Refer a student</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <StudentCombobox
                students={studentOptions}
                value={form.student_id}
                onChange={(v) => setForm({ ...form, student_id: v })}
                placeholder="Student"
              />
              <Input placeholder="Referred to (hospital/clinic)" value={form.referred_to} onChange={(e) => setForm({ ...form, referred_to: e.target.value })} />
              <Textarea placeholder="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              <Input type="date" value={form.referral_date} onChange={(e) => setForm({ ...form, referral_date: e.target.value })} />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.guardian_notified}
                  onChange={(e) => setForm({ ...form, guardian_notified: e.target.checked })}
                  className="size-4 rounded-sm border-border"
                />
                Guardian notified
              </label>
              {error && <p className="text-sm text-danger">{error}</p>}
            </div>
            <DialogFooter>
              <Button onClick={submit} disabled={pending}>
                {pending ? "Creating…" : "Create referral"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        )}
        <Input
          placeholder="Search by student name or admission number…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="table-dense w-full">
          <thead>
            <tr>
              <th className="text-left">Student</th>
              <th className="text-left">Referred to</th>
              <th className="text-left">Date</th>
              <th className="text-left">Guardian notified</th>
              <th className="text-left">Status</th>
              {canWrite && <th />}
            </tr>
          </thead>
          <tbody>
            {referrals.map((r) => (
              <tr key={r.id}>
                <td>{r.student_name}</td>
                <td>{r.referred_to}</td>
                <td>{r.referral_date}</td>
                <td>{r.guardian_notified ? "Yes" : "No"}</td>
                <td>
                  <StatusBadge tone={statusTone[r.status]} label={r.status} />
                </td>
                {canWrite && (
                  <td>
                    {r.status === "pending" &&
                      (resolvingId === r.id ? (
                        <div className="flex items-center gap-1">
                          <Input
                            className="h-8 w-40"
                            placeholder="Outcome notes"
                            value={outcomeNotes}
                            onChange={(e) => setOutcomeNotes(e.target.value)}
                          />
                          <Button size="sm" onClick={() => resolve(r.id, "completed")} disabled={pending}>
                            Complete
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setResolvingId(r.id)}>
                          Resolve
                        </Button>
                      ))}
                  </td>
                )}
              </tr>
            ))}
            {referrals.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted-foreground">
                  {search ? "No referrals match this search." : "No referrals on record."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>
          {totalCount === 0
            ? ""
            : `Showing ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, totalCount)} of ${totalCount}`}
        </span>
        {pageCount > 1 && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(pageIndex - 1)}>
              Previous
            </Button>
            <span>
              Page {page} of {pageCount}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= pageCount}
              onClick={() => onPageChange(pageIndex + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ReferralsSection(props: {
  referrals: ReferralRow[];
  totalCount: number;
  pageSize: number;
  studentOptions: StudentOption[];
  canWrite: boolean;
}) {
  return (
    <Suspense fallback={null}>
      <ReferralsSectionInner {...props} />
    </Suspense>
  );
}
