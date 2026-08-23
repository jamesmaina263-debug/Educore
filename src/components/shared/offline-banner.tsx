"use client";

import type { ReactNode } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { QueuedMutation } from "@/lib/offline/queue";

export interface OfflineBannerProps {
  online: boolean;
  pendingCount: number;
  failed: QueuedMutation[];
  syncing: boolean;
  sync: () => void;
  discard: (id: string) => void;
  /** Maps a queued mutation's `type` to a human-readable label. */
  mutationLabels: Record<string, string>;
  /** Message shown while offline. Defaults to a generic "what you submit is saved" notice. */
  offlineMessage?: ReactNode;
  /** Label shown in the pending banner while a sync is in flight. */
  syncingLabel?: string;
  /** Noun used for queued items ("entry/entries" by default, e.g. "submission/submissions"). */
  unitNoun?: { singular: string; plural: string };
  /** Optional clause appended to the failed-sync message, e.g. "usually because ...". */
  failedNote?: string;
}

const DEFAULT_OFFLINE_MESSAGE = (
  <>
    You&apos;re offline. What you submit now is saved on this device and will sync automatically once you&apos;re
    back online.
  </>
);

const DEFAULT_UNIT_NOUN = { singular: "entry", plural: "entries" };

/**
 * Shared offline-queue status banner: an "offline" notice, a "pending sync"
 * notice with a manual retry, and a "failed" list with per-item discard.
 *
 * Each module (library, discipline, staff, exams, inventory, boarding,
 * health, admissions) wraps this with its own mutation labels and copy —
 * see the module's `offline-banner.tsx` for the thin wrapper.
 */
export function OfflineBanner({
  online,
  pendingCount,
  failed,
  syncing,
  sync,
  discard,
  mutationLabels,
  offlineMessage = DEFAULT_OFFLINE_MESSAGE,
  syncingLabel = "Syncing offline entries…",
  unitNoun = DEFAULT_UNIT_NOUN,
  failedNote,
}: OfflineBannerProps) {
  const unit = (count: number) => (count === 1 ? unitNoun.singular : unitNoun.plural);

  return (
    <>
      {!online && (
        <div className="panel flex items-center gap-2 border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-warning-foreground">
          <WifiOff className="size-4 shrink-0" aria-hidden />
          <span>{offlineMessage}</span>
        </div>
      )}
      {online && pendingCount > 0 && (
        <div className="panel flex items-center gap-2 border-border bg-muted/50 px-4 py-2.5 text-sm text-muted-foreground">
          <RefreshCw className={"size-4 shrink-0 " + (syncing ? "animate-spin" : "")} aria-hidden />
          <span>{syncing ? syncingLabel : `${pendingCount} offline ${unit(pendingCount)} waiting to sync.`}</span>
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
            {failed.length} offline {unit(failed.length)} couldn&apos;t sync and won&apos;t succeed by retrying
            {failedNote ? ` — ${failedNote}` : ""}.
          </p>
          {failed.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-2 rounded-md bg-background/60 px-3 py-1.5">
              <span className="text-muted-foreground">
                {mutationLabels[f.type] ?? f.type}
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
