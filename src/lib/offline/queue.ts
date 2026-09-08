import { idbDelete, idbGet, idbPut, STORES } from "./db";
import { getAllByIndexEncrypted, getAllEncrypted, putEncrypted } from "./crypto";
import { mutationHandlers } from "./handlers";

export interface QueuedMutation<TPayload = unknown> {
  id: string;
  /** e.g. "attendance", "health", "library" -- lets a screen filter to just its own queue. */
  module: string;
  /** e.g. "submitAttendance" -- looked up in mutationHandlers as `${module}:${type}`. */
  type: string;
  payload: TPayload;
  queued_at: string;
  status: "pending" | "syncing" | "failed";
  last_error?: string;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Queue a write for later replay. Call this from a form's submit handler when `useOfflineSync().online` is false. */
export async function queueMutation<TPayload>(
  module: string,
  type: string,
  payload: TPayload,
): Promise<QueuedMutation<TPayload>> {
  const record: QueuedMutation<TPayload> = {
    id: newId(),
    module,
    type,
    payload,
    queued_at: new Date().toISOString(),
    status: "pending",
  };
  // OS-10: `payload` is encrypted at rest -- it's the field that actually carries PII
  // (attendance marks, health notes, admissions identity fields, etc).
  await putEncrypted(STORES.pendingMutations, record as unknown as Record<string, unknown>, "payload");
  return record;
}

/** List everything still waiting to sync, optionally scoped to one module. */
export async function getPendingMutations<TPayload = unknown>(module?: string): Promise<QueuedMutation<TPayload>[]> {
  if (module) {
    return getAllByIndexEncrypted<QueuedMutation<TPayload> & Record<string, unknown>>(STORES.pendingMutations, "by_module", module, "payload");
  }
  return getAllEncrypted<QueuedMutation<TPayload> & Record<string, unknown>>(STORES.pendingMutations, "payload");
}

/**
 * Remove a mutation from the queue without syncing it -- for items whose
 * status is "failed" for a reason retrying can never fix (e.g. someone else
 * already submitted the same record while this device was offline, so the
 * server's uniqueness check will reject it identically every time).
 */
export async function discardMutation(id: string): Promise<void> {
  await idbDelete(STORES.pendingMutations, id);
}

/**
 * Replay every queued mutation (optionally scoped to one module) against its
 * registered handler, in the order it was queued.
 *
 * - No handler registered for a mutation -> left pending untouched (rather
 *   than dropped), so it isn't silently lost if this runs on an app version
 *   that predates that module's offline support being wired up.
 * - Handler resolves with `{ error }` -> marked "failed" with the reason,
 *   still in the queue for the user to review/retry/discard.
 * - Handler throws (most commonly a fetch TypeError because we just went
 *   back offline) -> left "pending", and the whole pass stops rather than
 *   burning through the rest of the queue against a connection that isn't
 *   really there.
 *
 * OS-04: `reachedServer` distinguishes "we genuinely confirmed sync status
 * with the server" (queue was empty, or every item was actually attempted --
 * even ones that failed for a real business reason, e.g. a validation error,
 * still involved a real round trip) from "we never actually got there"
 * (aborted early on a raw network TypeError). Callers use this, not
 * `synced`/`failed` counts alone, to decide whether "last synced" genuinely
 * advances -- an all-network-failure pass shouldn't claim a fresh sync time.
 */
export async function syncPendingMutations(module?: string): Promise<{ synced: number; failed: number; reachedServer: boolean }> {
  const pending = await getPendingMutations(module);
  let synced = 0;
  let failed = 0;
  let reachedServer = true;

  for (const mutation of pending) {
    const handler = mutationHandlers[`${mutation.module}:${mutation.type}`];
    if (!handler) continue;

    await putEncrypted(STORES.pendingMutations, { ...mutation, status: "syncing" } as unknown as Record<string, unknown>, "payload");
    try {
      const result = await handler(mutation.payload as never);
      if (result && typeof result === "object" && "error" in result) {
        await putEncrypted(
          STORES.pendingMutations,
          { ...mutation, status: "failed", last_error: String((result as { error: unknown }).error) } as unknown as Record<string, unknown>,
          "payload",
        );
        failed += 1;
      } else {
        await idbDelete(STORES.pendingMutations, mutation.id);
        synced += 1;
      }
    } catch (e) {
      await putEncrypted(STORES.pendingMutations, { ...mutation, status: "pending" } as unknown as Record<string, unknown>, "payload");
      failed += 1;
      if (e instanceof TypeError) {
        reachedServer = false;
        break;
      }
    }
  }

  if (reachedServer) await setLastSyncedAt(module);
  return { synced, failed, reachedServer };
}

function lastSyncedKey(module?: string): string {
  return `last_synced:${module ?? "_global"}`;
}

/** OS-04: record "now" as this module's last confirmed sync time. Not sensitive -- plain (unencrypted) storage in the generic cached_reads store. */
async function setLastSyncedAt(module?: string): Promise<void> {
  await idbPut(STORES.cachedReads, { key: lastSyncedKey(module), value: Date.now() });
}

/** OS-04: epoch ms of this module's last confirmed sync, or undefined if it's never synced on this device. */
export async function getLastSyncedAt(module?: string): Promise<number | undefined> {
  const record = await idbGet<{ key: string; value: number }>(STORES.cachedReads, lastSyncedKey(module));
  return record?.value;
}
