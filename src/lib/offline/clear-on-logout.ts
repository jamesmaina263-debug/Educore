"use client";

import { idbClear, STORES } from "./db";

/**
 * Wipes everything that could leak one signed-in session's data into the
 * next -- called from topbar.tsx right before the sign-out Server Action
 * runs (see handleSignOut there).
 *
 * Deliberately does NOT touch `pending_mutations` -- a queued-but-not-yet-
 * synced offline write (e.g. attendance marked while offline, not yet
 * synced) belongs to the device/session that queued it and shouldn't be
 * silently discarded just because that person signed out before
 * reconnecting; it'll still sync correctly next time someone (anyone, with
 * the right permissions) is signed in and online, since the queued
 * mutation replays through the same Server Action + RLS check it always
 * would have.
 *
 * What IS cleared:
 * - The service worker's RUNTIME_CACHE (see public/sw.js) -- full rendered
 *   pages, which do contain this session's/school's data. Left uncleared,
 *   a different person signing in on the same device could be served a
 *   stale offline copy of the previous person's dashboard/roster/etc.
 * - `cached_reads` in IndexedDB -- scaffolded for future per-module read
 *   caching (see db.ts); cleared preemptively for the same reason, even
 *   though nothing writes to it yet.
 *
 * Best-effort: if the service worker isn't controlling this page yet (e.g.
 * first load before it's activated) or IndexedDB is unavailable, this
 * silently no-ops rather than blocking sign-out -- a slightly-too-long-
 * lived cache is a much smaller problem than sign-out itself failing.
 */
export async function clearOfflineCaches(): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  if (typeof navigator !== "undefined" && navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "CLEAR_RUNTIME_CACHE" });
  }

  tasks.push(idbClear(STORES.cachedReads).catch(() => undefined));

  await Promise.all(tasks);
}
