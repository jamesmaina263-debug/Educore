"use client";

import { useCallback, useEffect, useState } from "react";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { discardMutation, getPendingMutations, syncPendingMutations, type QueuedMutation } from "@/lib/offline/queue";

/**
 * Drop-in offline-sync hook for any module. Pass the same `module` string
 * you use with queueMutation() so this only counts/syncs that module's queue
 * (e.g. a nurse retrying the health queue shouldn't also replay someone
 * else's still-offline attendance queue on a shared device).
 *
 * Omit `module` to track every pending mutation across the whole app --
 * useful for a global "N changes waiting to sync" indicator.
 *
 * `pendingCount` excludes items that have permanently failed (a retry can't
 * fix them); those show up in `failed` instead, alongside `discard(id)` to
 * remove one from the queue. This mirrors attendance's own hook
 * (use-attendance-sync.ts), which predates this generic version and is left
 * as-is since its typed return shape is more convenient for that module.
 */
export function useOfflineSync(module?: string) {
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [failed, setFailed] = useState<QueuedMutation[]>([]);
  const [syncing, setSyncing] = useState(false);

  const refreshCounts = useCallback(() => {
    return getPendingMutations(module)
      .then((pending) => {
        setPendingCount(pending.filter((m) => m.status !== "failed").length);
        setFailed(pending.filter((m) => m.status === "failed"));
      })
      .catch(() => {
        setPendingCount(0);
        setFailed([]);
      });
  }, [module]);

  // Manual "Retry now" button calls this directly from a click handler --
  // setState there is a normal user-triggered update, not subject to the
  // effect restriction below.
  const sync = useCallback(() => {
    setSyncing(true);
    syncPendingMutations(module).finally(() => {
      setSyncing(false);
      refreshCounts();
    });
  }, [module, refreshCounts]);

  const discard = useCallback(
    (id: string) => {
      discardMutation(id).finally(() => refreshCounts());
    },
    [refreshCounts],
  );

  // Mount: read the current queue once. setState calls live inside
  // .then()/.catch() callbacks -- reactions to the promise resolving, not
  // synchronous calls within the effect's own execution.
  useEffect(() => {
    let cancelled = false;
    getPendingMutations(module)
      .then((pending) => {
        if (cancelled) return;
        setPendingCount(pending.filter((m) => m.status !== "failed").length);
        setFailed(pending.filter((m) => m.status === "failed"));
      })
      .catch(() => {
        if (!cancelled) {
          setPendingCount(0);
          setFailed([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [module]);

  // Connectivity restored: auto-sync this module's queue.
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    syncPendingMutations(module).finally(() => {
      if (cancelled) return;
      refreshCounts();
    });
    return () => {
      cancelled = true;
    };
  }, [online, module, refreshCounts]);

  return { online, pendingCount, failed, syncing, sync, discard };
}
