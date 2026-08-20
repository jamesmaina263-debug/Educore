import { idbDelete, idbGetAll, idbGetAllByIndex, idbPut, STORES } from "./db";
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
  await idbPut(STORES.pendingMutations, record);
  return record;
}

/** List everything still waiting to sync, optionally scoped to one module. */
export async function getPendingMutations<TPayload = unknown>(module?: string): Promise<QueuedMutation<TPayload>[]> {
  if (module) return idbGetAllByIndex<QueuedMutation<TPayload>>(STORES.pendingMutations, "by_module", module);
  return idbGetAll<QueuedMutation<TPayload>>(STORES.pendingMutations);
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
 */
export async function syncPendingMutations(module?: string): Promise<{ synced: number; failed: number }> {
  const pending = await getPendingMutations(module);
  let synced = 0;
  let failed = 0;

  for (const mutation of pending) {
    const handler = mutationHandlers[`${mutation.module}:${mutation.type}`];
    if (!handler) continue;

    await idbPut(STORES.pendingMutations, { ...mutation, status: "syncing" });
    try {
      const result = await handler(mutation.payload as never);
      if (result && typeof result === "object" && "error" in result) {
        await idbPut(STORES.pendingMutations, {
          ...mutation,
          status: "failed",
          last_error: String((result as { error: unknown }).error),
        });
        failed += 1;
      } else {
        await idbDelete(STORES.pendingMutations, mutation.id);
        synced += 1;
      }
    } catch (e) {
      await idbPut(STORES.pendingMutations, { ...mutation, status: "pending" });
      failed += 1;
      if (e instanceof TypeError) break;
    }
  }

  return { synced, failed };
}
