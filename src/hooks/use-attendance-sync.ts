"use client";

import { useCallback, useEffect, useState } from "react";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { getPendingAttendanceSubmissions, syncPendingAttendance } from "@/lib/offline/attendance-queue";

export function useAttendanceSync() {
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  // Manual "Retry now" button calls this directly from a click handler --
  // setState there is a normal user-triggered update, not subject to the
  // effect restriction below.
  const sync = useCallback(() => {
    setSyncing(true);
    syncPendingAttendance().finally(() => {
      setSyncing(false);
      getPendingAttendanceSubmissions()
        .then((pending) => setPendingCount(pending.length))
        .catch(() => setPendingCount(0));
    });
  }, []);

  // Mount: read the current queue length once. getPendingAttendanceSubmissions
  // is a plain imported function with no access to this hook's state; the
  // setState call lives inside its .then()/.catch() callback, which runs as
  // a reaction to the promise resolving -- not synchronously within the
  // effect's own execution.
  useEffect(() => {
    let cancelled = false;
    getPendingAttendanceSubmissions()
      .then((pending) => {
        if (!cancelled) setPendingCount(pending.length);
      })
      .catch(() => {
        if (!cancelled) setPendingCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Connectivity restored: auto-sync the queue. Same pattern -- the directly
  // (synchronously) called function is a plain imported utility; every
  // setState call is deferred into a .then()/.finally() callback.
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    syncPendingAttendance().finally(() => {
      if (cancelled) return;
      getPendingAttendanceSubmissions()
        .then((pending) => {
          if (!cancelled) setPendingCount(pending.length);
        })
        .catch(() => {
          if (!cancelled) setPendingCount(0);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [online]);

  return { online, pendingCount, syncing, sync };
}

