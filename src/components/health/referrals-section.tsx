"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createReferral, updateReferralOutcome } from "@/app/(app)/health/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
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

export function ReferralsSection({
  referrals,
  studentOptions,
  canWrite,
}: {
  referrals: ReferralRow[];
  studentOptions: StudentOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
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
              <Select value={form.student_id} onValueChange={(v) => setForm({ ...form, student_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Student" />
                </SelectTrigger>
                <SelectContent>
                  {studentOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                  No referrals on record.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
