"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { QueuedMutation } from "@/lib/offline/queue";

const MUTATION_LABELS: Record<string, string> = {
  checkInStudent: "Sick bay check-in",
  checkOutStudent: "Sick bay check-out",
  administerMedication: "Medication administered",
  logEmergency: "Emergency log",
  createReferral: "Referral",
};

/**
 * The three offline-queue banners shared by every health write form
 * (sick bay, medication, emergencies, referrals) -- all share the "health"
 * module queue, so a nurse sees one consistent count/status regardless of
 * which tab queued something.
 *
 * Queued items don't appear in this page's table until they've actually
 * synced (there's no local table row to show for something that only
 * exists in this device's IndexedDB yet) -- these banners are what confirm
 * "your submission was captured" in the meantime.
 */
export function HealthOfflineBanner({
  online,
  pendingCount,
  failed,
  syncing,
  sync,
  discard,
}: {
  online: boolean;
  pendingCount: number;
  failed: QueuedMutation[];
  syncing: boolean;
  sync: () => void;
  discard: (id: string) => void;
}) {
  return (
    <>
      {!online && (
        <div className="panel flex items-center gap-2 border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-warning-foreground">
          <WifiOff className="size-4 shrink-0" aria-hidden />
          <span>You&apos;re offline. What you submit now is saved on this device and will sync automatically once you&apos;re back online.</span>
        </div>
      )}
      {online && pendingCount > 0 && (
        <div className="panel flex items-center gap-2 border-border bg-muted/50 px-4 py-2.5 text-sm text-muted-foreground">
          <RefreshCw className={"size-4 shrink-0 " + (syncing ? "animate-spin" : "")} aria-hidden />
          <span>{syncing ? "Syncing offline entries…" : `${pendingCount} offline ${pendingCount === 1 ? "entry" : "entries"} waiting to sync.`}</span>
          {!syncing && (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => sync()}>
              Retry now
            </Button>
          )}
        </div>
      )}
      {failed.length > 0 && (
        <div className="panel flex flex-col gap-2 border-danger/40 bg-danger/10 px-4 py-2.5 text-sm">
          <p className="font-medium text-danger">
            {failed.length} offline {failed.length === 1 ? "entry" : "entries"} couldn&apos;t sync and won&apos;t succeed by retrying.
          </p>
          {failed.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-2 rounded-md bg-background/60 px-3 py-1.5">
              <span className="text-muted-foreground">
                {MUTATION_LABELS[f.type] ?? f.type}
                {f.last_error ? ` — ${f.last_error}` : ""}
              </span>
              <Button size="sm" variant="ghost" onClick={() => discard(f.id)}>
                Discard
              </Button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
