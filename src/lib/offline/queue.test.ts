import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

// db.ts caches its connection in a module-level variable, and each test
// needs a clean IndexedDB + a fresh module instance to see it, so every
// test gets its own fake IDBFactory and re-imports the modules under test
// via vi.resetModules().
async function freshModules() {
  vi.resetModules();
  const dbMod = await import("./db");
  const queueMod = await import("./queue");
  const handlersMod = await import("./handlers");
  return { dbMod, queueMod, handlersMod };
}

beforeEach(() => {
  // fake-indexeddb persists per-name across `new IDBFactory()` unless reset;
  // simplest isolation is a fresh factory per test.
  globalThis.indexedDB = new IDBFactory();
});

describe("offline mutation queue", () => {
  it("queues a mutation and lists it as pending", async () => {
    const { queueMod } = await freshModules();
    await queueMod.queueMutation("attendance", "submitAttendance", { foo: "bar" });
    const pending = await queueMod.getPendingMutations("attendance");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ module: "attendance", type: "submitAttendance", status: "pending" });
  });

  it("scopes getPendingMutations to the requested module", async () => {
    const { queueMod } = await freshModules();
    await queueMod.queueMutation("attendance", "submitAttendance", { a: 1 });
    await queueMod.queueMutation("health", "checkInStudent", { b: 2 });

    expect(await queueMod.getPendingMutations("attendance")).toHaveLength(1);
    expect(await queueMod.getPendingMutations("health")).toHaveLength(1);
    expect(await queueMod.getPendingMutations()).toHaveLength(2);
  });

  it("removes a mutation from the queue once its handler succeeds", async () => {
    vi.doMock("@/app/(app)/attendance/actions", () => ({
      submitAttendance: vi.fn().mockResolvedValue({ success: true }),
    }));
    const { queueMod } = await freshModules();
    await queueMod.queueMutation("attendance", "submitAttendance", { stream_id: "s1", attendance_date: "2026-01-01", marks: [] });

    const result = await queueMod.syncPendingMutations("attendance");

    expect(result).toEqual({ synced: 1, failed: 0 });
    expect(await queueMod.getPendingMutations("attendance")).toHaveLength(0);
  });

  it("marks a mutation failed (but keeps it queued) when the handler returns an error", async () => {
    vi.doMock("@/app/(app)/attendance/actions", () => ({
      submitAttendance: vi.fn().mockResolvedValue({ error: "Could not resolve your school." }),
    }));
    const { queueMod } = await freshModules();
    await queueMod.queueMutation("attendance", "submitAttendance", { stream_id: "s1", attendance_date: "2026-01-01", marks: [] });

    const result = await queueMod.syncPendingMutations("attendance");

    expect(result).toEqual({ synced: 0, failed: 1 });
    const pending = await queueMod.getPendingMutations("attendance");
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("failed");
    expect(pending[0].last_error).toBe("Could not resolve your school.");
  });

  it("leaves a mutation pending (not failed) and stops the pass when the network drops mid-sync", async () => {
    vi.doMock("@/app/(app)/attendance/actions", () => ({
      submitAttendance: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    }));
    const { queueMod } = await freshModules();
    await queueMod.queueMutation("attendance", "submitAttendance", { stream_id: "s1", attendance_date: "2026-01-01", marks: [] });
    await queueMod.queueMutation("attendance", "submitAttendance", { stream_id: "s2", attendance_date: "2026-01-01", marks: [] });

    const result = await queueMod.syncPendingMutations("attendance");

    expect(result.synced).toBe(0);
    const pending = await queueMod.getPendingMutations("attendance");
    expect(pending).toHaveLength(2);
    expect(pending.every((m) => m.status === "pending")).toBe(true);
  });

  it("discards a failed mutation without retrying it", async () => {
    const { queueMod } = await freshModules();
    const record = await queueMod.queueMutation("attendance", "submitAttendance", { stream_id: "s1", attendance_date: "2026-01-01", marks: [] });
    await queueMod.discardMutation(record.id);
    expect(await queueMod.getPendingMutations("attendance")).toHaveLength(0);
  });

  it("leaves a mutation untouched when no handler is registered for it", async () => {
    const { queueMod } = await freshModules();
    await queueMod.queueMutation("some-future-module", "someAction", { x: 1 });

    const result = await queueMod.syncPendingMutations("some-future-module");

    expect(result).toEqual({ synced: 0, failed: 0 });
    expect(await queueMod.getPendingMutations("some-future-module")).toHaveLength(1);
  });
});

describe("v1 -> v2 schema migration", () => {
  it("migrates records already queued in the legacy pending_attendance store instead of dropping them", async () => {
    // Simulate a device that has the app installed at schema v1, with one
    // attendance submission already queued offline (not yet synced).
    vi.resetModules();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("educore-offline", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("pending_attendance", { keyPath: "id" });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("pending_attendance", "readwrite");
        tx.objectStore("pending_attendance").put({
          id: "legacy-1",
          stream_id: "stream-9",
          attendance_date: "2026-02-01",
          marks: [{ student_id: "stu-1", status: "present" }],
          queued_at: "2026-02-01T08:00:00.000Z",
          status: "pending",
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    // Now open with the current (v2) code -- this should trigger the
    // migration in db.ts's onupgradeneeded.
    const { queueMod } = await freshModules();
    const migrated = await queueMod.getPendingMutations("attendance");

    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toMatchObject({
      id: "legacy-1",
      module: "attendance",
      type: "submitAttendance",
      status: "pending",
      payload: {
        stream_id: "stream-9",
        attendance_date: "2026-02-01",
        marks: [{ student_id: "stu-1", status: "present" }],
      },
    });

    // And the legacy store should be gone post-migration.
    const dbCheck = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("educore-offline");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect(dbCheck.objectStoreNames.contains("pending_attendance")).toBe(false);
    expect(dbCheck.objectStoreNames.contains("pending_mutations")).toBe(true);
    dbCheck.close();
  });
});
