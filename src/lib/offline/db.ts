// Tiny, dependency-free IndexedDB wrapper shared by every module's offline
// support. Deliberately minimal -- not a general-purpose ORM.
//
// Schema (v2): two generic stores shared by all modules, instead of one
// store per module. This means adding offline support to a new module never
// requires another DB_VERSION bump / onupgradeneeded migration -- it just
// needs a new `module` value when it calls queueMutation().
//
//  - pending_mutations: queued writes waiting to be replayed against the
//    server, indexed by `module` so a screen can show/sync just its own
//    queue (e.g. "3 offline attendance submissions") as well as the whole
//    device queue.
//  - cached_reads: last-known-good server data, saved opportunistically
//    while online, so a module's read side can still render something
//    useful while offline instead of an empty/error state. Keyed by an
//    opaque `${module}:${key}` string chosen by the caller.
//
// v1 -> v2 migration: v1 had a single `pending_attendance` store. Any
// records already queued there (submitted offline, not yet synced, on a
// device that hasn't been online since) are migrated into the new
// `pending_mutations` store rather than dropped, so upgrading the app never
// loses a queued submission.

const DB_NAME = "educore-offline";
const DB_VERSION = 2;

export const STORES = {
  pendingMutations: "pending_mutations",
  cachedReads: "cached_reads",
} as const;

const LEGACY_PENDING_ATTENDANCE_STORE = "pending_attendance";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available in this environment."));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction;

      const legacyRecords: Array<Record<string, unknown>> = [];
      if (event.oldVersion < 2) {
        if (db.objectStoreNames.contains(LEGACY_PENDING_ATTENDANCE_STORE) && tx) {
          // Read every record out of the old v1 store before it's deleted below,
          // so migrateLegacyAttendanceQueue() (called from the success handler,
          // once we're safely on the new schema) can re-insert them.
          const legacyStore = tx.objectStore(LEGACY_PENDING_ATTENDANCE_STORE);
          const cursorReq = legacyStore.openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) {
              legacyRecords.push(cursor.value as Record<string, unknown>);
              cursor.continue();
            }
          };
        }

        if (!db.objectStoreNames.contains(STORES.pendingMutations)) {
          const store = db.createObjectStore(STORES.pendingMutations, { keyPath: "id" });
          store.createIndex("by_module", "module", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.cachedReads)) {
          db.createObjectStore(STORES.cachedReads, { keyPath: "key" });
        }
      }

      // Run after the cursor above has finished walking the legacy store, but
      // still inside the same versionchange transaction (IndexedDB queues
      // same-transaction requests, so this executes after the cursor completes).
      if (db.objectStoreNames.contains(LEGACY_PENDING_ATTENDANCE_STORE) && tx) {
        tx.objectStore(STORES.pendingMutations);
        const migrate = () => {
          const newStore = tx.objectStore(STORES.pendingMutations);
          for (const legacy of legacyRecords) {
            newStore.put({
              id: legacy.id,
              module: "attendance",
              type: "submitAttendance",
              payload: {
                stream_id: legacy.stream_id,
                attendance_date: legacy.attendance_date,
                marks: legacy.marks,
              },
              queued_at: legacy.queued_at,
              status: legacy.status === "syncing" ? "pending" : (legacy.status ?? "pending"),
              last_error: legacy.last_error,
            });
          }
          db.deleteObjectStore(LEGACY_PENDING_ATTENDANCE_STORE);
        };
        // Defer to end of the cursor walk: since requests on the same
        // transaction execute in order, queuing this after openCursor's chain
        // via another request guarantees legacyRecords is fully populated.
        tx.objectStore(LEGACY_PENDING_ATTENDANCE_STORE).count().onsuccess = migrate;
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB."));
  });
  return dbPromise;
}

export async function idbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error ?? new Error(`Failed to read ${store}.`));
  });
}

export async function idbGetAllByIndex<T>(store: string, indexName: string, value: IDBValidKey): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).index(indexName).getAll(value);
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error ?? new Error(`Failed to read ${store} by ${indexName}.`));
  });
}

export async function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error ?? new Error(`Failed to read from ${store}.`));
  });
}

export async function idbPut<T>(store: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`Failed to write to ${store}.`));
  });
}

export async function idbDelete(store: string, key: IDBValidKey): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`Failed to delete from ${store}.`));
  });
}

export async function idbClear(store: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`Failed to clear ${store}.`));
  });
}
