import { idbDelete, STORES } from "./db";
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
  /**
   * Consecutive times this mutation has thrown (rather than resolved) during a sync pass.
   * Undefined/0 for anything queued before this field existed or that has never thrown.
   * See MAX_TYPEERROR_ATTEMPTS below.
   */
  attempts?: number;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// queued_at has millisecond resolution, and the store's key is a random UUID, so two writes queued
// within the same millisecond used to tie in getPendingMutations()'s sort and come back in random
// (UUID) order -- silently breaking the "replay in the order it happened" guarantee below (and
// making the queue's own tests flaky). Each timestamp is forced to be strictly later than the last.
let lastQueuedAtMs = 0;
function nextQueuedAt(): string {
  lastQueuedAtMs = Math.max(Date.now(), lastQueuedAtMs + 1);
  return new Date(lastQueuedAtMs).toISOString();
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
    queued_at: nextQueuedAt(),
    status: "pending",
  };
  // OS-10: `payload` is encrypted at rest -- it's the field that actually carries PII
  // (attendance marks, health notes, admissions identity fields, etc).
  await putEncrypted(STORES.pendingMutations, record as unknown as Record<string, unknown>, "payload");
  return record;
}

/** List everything still waiting to sync, optionally scoped to one module. Returned in the
 * order it was queued (oldest first) -- callers rely on this, most importantly
 * syncPendingMutations() replaying dependent writes (e.g. a case created offline, then
 * something added to it in a later offline action) in the order they actually happened.
 * IndexedDB's getAll() returns rows in *key* order, not insertion order, and this store's
 * key is a random UUID -- so this needs an explicit sort, not just a raw getAll().
 */
export async function getPendingMutations<TPayload = unknown>(module?: string): Promise<QueuedMutation<TPayload>[]> {
  const records = module
    ? await getAllByIndexEncrypted<QueuedMutation<TPayload> & Record<string, unknown>>(STORES.pendingMutations, "by_module", module, "payload")
    : await getAllEncrypted<QueuedMutation<TPayload> & Record<string, unknown>>(STORES.pendingMutations, "payload");
  return records.sort((a, b) => a.queued_at.localeCompare(b.queued_at));
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

// A TypeError from a Server Action call is almost always the browser's fetch failing
// because the device just went offline -- but it's also what JS throws for plenty of
// unrelated bugs (a null property access, calling something that isn't a function). If a
// single queued mutation always throws for one of those reasons rather than a real
// connectivity issue, treating every throw as "we're offline" means it would silently
// block its entire module's queue on every single sync attempt, forever, even on a
// perfectly good connection -- and since it's never marked "failed", it never appears in
// useOfflineSync()'s `failed` list, so there's no way for the user to see or discard it.
// After MAX_TYPEERROR_ATTEMPTS separate sync passes, stop giving this specific item the
// benefit of the doubt and surface it as a real failure instead.
const MAX_TYPEERROR_ATTEMPTS = 5;

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
 *   really there -- unless this exact item has now thrown
 *   MAX_TYPEERROR_ATTEMPTS times in a row, in which case it's marked
 *   "failed" instead (see MAX_TYPEERROR_ATTEMPTS above) and the pass
 *   continues on to whatever's queued after it.
 */
export async function syncPendingMutations(module?: string): Promise<{ synced: number; failed: number }> {
  const pending = await getPendingMutations(module);
  let synced = 0;
  let failed = 0;

  for (const mutation of pending) {
    const handler = mutationHandlers[`${mutation.module}:${mutation.type}`];
    if (!handler) continue;

    await putEncrypted(STORES.pendingMutations, { ...mutation, status: "syncing" } as unknown as Record<string, unknown>, "payload");
    try {
      const result = await handler(mutation.payload as never);
      if (result && typeof result === "object" && "error" in result) {
        await putEncrypted(
          STORES.pendingMutations,
          { ...mutation, status: "failed", attempts: 0, last_error: String((result as { error: unknown }).error) } as unknown as Record<string, unknown>,
          "payload",
        );
        failed += 1;
      } else {
        await idbDelete(STORES.pendingMutations, mutation.id);
        synced += 1;
      }
    } catch (e) {
      const attempts = (mutation.attempts ?? 0) + 1;
      failed += 1;
      if (e instanceof TypeError && attempts < MAX_TYPEERROR_ATTEMPTS) {
        await putEncrypted(STORES.pendingMutations, { ...mutation, status: "pending", attempts } as unknown as Record<string, unknown>, "payload");
        break;
      }
      // Either a non-TypeError exception (never a connectivity issue), or a TypeError
      // that's persisted across MAX_TYPEERROR_ATTEMPTS passes despite presumably having
      // been online for at least some of them -- treat this one item as broken rather
      // than the connection, and let the rest of the queue keep going.
      await putEncrypted(
        STORES.pendingMutations,
        {
          ...mutation,
          status: "failed",
          attempts,
          last_error: e instanceof Error ? e.message : "Could not sync this item after several attempts.",
        } as unknown as Record<string, unknown>,
        "payload",
      );
    }
  }

  return { synced, failed };
}
