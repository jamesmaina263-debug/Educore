"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { suspendSchool, reactivateSchool } from "@/app/(admin)/admin/actions";

export interface SchoolListRow {
  id: string;
  name: string;
  slug: string;
  status: "trial" | "active" | "suspended" | "cancelled";
  student_count: number;
  staff_count: number;
  plan_name: string | null;
  /** Only meaningful when status === "trial" -- null otherwise (no trial, or trial already resolved). */
  trial_ends_at: string | null;
  /**
   * Coarse signal of whether a school has done real setup work, derived from whether it has
   * any classes, streams, and an active fee structure -- not a tracked "onboarding wizard"
   * step (none exists yet), so treat this as approximate, same spirit as the demo funnel's
   * "Approximated from status" notes on /admin/analytics.
   */
  onboarding_stage: "not_started" | "in_progress" | "complete";
  /**
   * Latest auth.users.last_sign_in_at across everyone with a school_users row at this
   * school (sourced from the admin_school_last_active() RPC). Null covers two different
   * cases the UI can't tell apart from this field alone: no one there has ever signed in,
   * or the school has no auth-linked school_users rows at all -- both render as "No login
   * activity recorded" rather than guessing which.
   */
  last_active_at: string | null;
}

const STATUS_TONE: Record<SchoolListRow["status"], "success" | "warning" | "danger" | "neutral"> = {
  active: "success",
  trial: "warning",
  suspended: "danger",
  cancelled: "neutral",
};

const ONBOARDING_LABEL: Record<SchoolListRow["onboarding_stage"], string> = {
  not_started: "Setup not started",
  in_progress: "Setup in progress",
  complete: "Setup complete",
};

const ONBOARDING_TONE: Record<SchoolListRow["onboarding_stage"], "success" | "warning" | "neutral"> = {
  complete: "success",
  in_progress: "warning",
  not_started: "neutral",
};

// Whole days until trial_ends_at, rounded up so "expires in the next few hours" still reads
// as 1 day rather than 0 -- 0 is reserved for "already past due" (shown as overdue instead).
function trialDaysLeft(trialEndsAt: string): number {
  const ms = new Date(trialEndsAt).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

// null covers "no one has ever signed in" and "no auth-linked users at all" -- both surface
// as the same honest "no recorded activity" label rather than a fabricated date.
function formatLastActive(lastActiveAt: string | null): { label: string; stale: boolean } {
  if (!lastActiveAt) return { label: "No login activity recorded", stale: false };
  const days = Math.floor((Date.now() - new Date(lastActiveAt).getTime()) / 86_400_000);
  if (days <= 0) return { label: "Active today", stale: false };
  if (days === 1) return { label: "Active yesterday", stale: false };
  return { label: `Last active ${days}d ago`, stale: days > 30 };
}

type FilterKey = "all" | "active" | "suspended";

export function AdminSchoolList({ schools }: { schools: SchoolListRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Which school's suspend-reason dialog is open, if any -- one dialog instance reused
  // across rows rather than one per row, same reasoning as Billing's single expanded-row state.
  const [suspendTarget, setSuspendTarget] = useState<SchoolListRow | null>(null);
  const [reason, setReason] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return schools.filter((s) => {
      if (filter === "active" && s.status !== "active") return false;
      if (filter === "suspended" && s.status !== "suspended") return false;
      if (q && !s.name.toLowerCase().includes(q) && !s.slug.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [schools, query, filter]);

  function run(fn: () => Promise<{ error: string } | { success: true }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  function openSuspend(school: SchoolListRow) {
    setError(null);
    setReason("");
    setSuspendTarget(school);
  }

  function confirmSuspend() {
    if (!suspendTarget) return;
    const target = suspendTarget;
    run(async () => {
      const res = await suspendSchool(target.id, reason.trim());
      if (!("error" in res)) setSuspendTarget(null);
      return res;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <Input
        placeholder="Search schools..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="suspended">Suspended</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-2">
        {filtered.length === 0 ? (
          <p className="panel p-4 text-sm text-muted-foreground">No schools match this filter.</p>
        ) : (
          filtered.map((school) => (
            <div key={school.id} className="panel-interactive flex items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold uppercase",
                  )}
                >
                  {school.name.slice(0, 1)}
                </div>
                <div>
                  <p className="text-sm font-semibold">{school.name}</p>
                  <p className="text-xs text-muted-foreground">/{school.slug}</p>
                  <p className="text-xs text-muted-foreground">
                    {school.student_count} student{school.student_count === 1 ? "" : "s"} ·{" "}
                    {school.staff_count} staff
                  </p>
                  <StatusBadge
                    tone={ONBOARDING_TONE[school.onboarding_stage]}
                    label={ONBOARDING_LABEL[school.onboarding_stage]}
                    className="mt-1"
                    title="Based on whether the school has any classes, streams, and an active fee structure -- not a tracked setup checklist"
                  />
                  <p
                    className={cn(
                      "mt-1 text-xs",
                      formatLastActive(school.last_active_at).stale ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {formatLastActive(school.last_active_at).label}
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusBadge tone={STATUS_TONE[school.status]} label={school.status} />
                {school.status === "trial" && school.trial_ends_at && (
                  <span
                    className={cn(
                      "text-xs font-medium",
                      trialDaysLeft(school.trial_ends_at) <= 3 ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {trialDaysLeft(school.trial_ends_at) <= 0
                      ? "Trial ended"
                      : `Trial ends in ${trialDaysLeft(school.trial_ends_at)}d`}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">{school.plan_name ?? "No plan"}</span>
                <div className="mt-1 flex items-center gap-1.5">
                  {school.status === "suspended" || school.status === "cancelled" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => run(() => reactivateSchool(school.id))}
                    >
                      Reactivate
                    </Button>
                  ) : (
                    <Button size="sm" variant="destructive" disabled={pending} onClick={() => openSuspend(school)}>
                      Suspend
                    </Button>
                  )}
                  <Link
                    href="/admin/billing"
                    className="flex items-center gap-0.5 text-xs text-primary hover:underline"
                  >
                    Manage <ArrowRight className="size-3" />
                  </Link>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={suspendTarget !== null} onOpenChange={(open) => !open && setSuspendTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend {suspendTarget?.name}</DialogTitle>
            <DialogDescription>
              This immediately blocks the school&apos;s own staff from signing in and stops it accepting new
              applications. Reverse it any time with Reactivate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Reason (visible on the subscription record)</p>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Non-payment, Term 2 invoice overdue 21 days"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendTarget(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmSuspend} disabled={pending}>
              Suspend school
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
