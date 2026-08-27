import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Same isolation strategy as queue.test.ts: fresh IndexedDB + fresh module
// graph per test, so each test's mocked kiosk-client is actually the one
// in effect when handlers.ts (imported transitively via queue.ts) resolves it.
async function freshModules() {
  vi.resetModules();
  const queueMod = await import("./queue");
  return { queueMod };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

const samplePayload = {
  device_key: "bio_abc12345.secret",
  event_id: "evt-1",
  result: "success" as const,
  credential_reference: "ref-1",
  event_type: "check_in" as const,
  occurred_at: "2026-08-24T05:00:00.000Z",
};

describe("biometric-kiosk offline queue", () => {
  it("queues a scan and lists it as pending, scoped to its own module", async () => {
    const { queueMod } = await freshModules();
    await queueMod.queueMutation("biometric-kiosk", "submitScan", samplePayload);
    await queueMod.queueMutation("attendance", "submitAttendance", { stream_id: "s1", attendance_date: "2026-01-01", marks: [] });

    expect(await queueMod.getPendingMutations("biometric-kiosk")).toHaveLength(1);
    expect(await queueMod.getPendingMutations("attendance")).toHaveLength(1);
    expect(await queueMod.getPendingMutations()).toHaveLength(2);
  });

  it("replays a queued scan through submitScan (the fetch-based handler, not a Server Action) and drains the queue on success", async () => {
    const submitScan = vi.fn().mockResolvedValue({ success: true, verification: "success", event_created: true });
    vi.doMock("@/lib/biometric/kiosk-client", () => ({ submitScan }));

    const { queueMod } = await freshModules();
    await queueMod.queueMutation("biometric-kiosk", "submitScan", samplePayload);

    const result = await queueMod.syncPendingMutations("biometric-kiosk");

    expect(result).toEqual({ synced: 1, failed: 0 });
    expect(submitScan).toHaveBeenCalledWith(samplePayload);
    expect(await queueMod.getPendingMutations("biometric-kiosk")).toHaveLength(0);
  });

  it("marks a scan failed (but keeps it queued) when biometric-verify rejects it -- e.g. a revoked credential", async () => {
    const submitScan = vi.fn().mockResolvedValue({ error: "This credential has been revoked." });
    vi.doMock("@/lib/biometric/kiosk-client", () => ({ submitScan }));

    const { queueMod } = await freshModules();
    await queueMod.queueMutation("biometric-kiosk", "submitScan", samplePayload);

    const result = await queueMod.syncPendingMutations("biometric-kiosk");

    expect(result).toEqual({ synced: 0, failed: 1 });
    const pending = await queueMod.getPendingMutations("biometric-kiosk");
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("failed");
    expect(pending[0].last_error).toBe("This credential has been revoked.");
  });

  it("leaves a scan pending (not failed) and stops the sync pass when the network drops mid-replay", async () => {
    const submitScan = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.doMock("@/lib/biometric/kiosk-client", () => ({ submitScan }));

    const { queueMod } = await freshModules();
    await queueMod.queueMutation("biometric-kiosk", "submitScan", samplePayload);
    await queueMod.queueMutation("biometric-kiosk", "submitScan", { ...samplePayload, event_id: "evt-2" });

    const result = await queueMod.syncPendingMutations("biometric-kiosk");

    expect(result.synced).toBe(0);
    const pending = await queueMod.getPendingMutations("biometric-kiosk");
    expect(pending).toHaveLength(2);
    expect(pending.every((m) => m.status === "pending")).toBe(true);
  });

  it("retains the same event_id across a retried replay -- this is what makes a duplicate-scan replay idempotent server-side, not client dedupe", async () => {
    const submitScan = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce({
      success: true,
      verification: "success",
      event_created: false,
      replay: true,
    });
    vi.doMock("@/lib/biometric/kiosk-client", () => ({ submitScan }));

    const { queueMod } = await freshModules();
    await queueMod.queueMutation("biometric-kiosk", "submitScan", samplePayload);

    await queueMod.syncPendingMutations("biometric-kiosk"); // fails, stays queued
    await queueMod.syncPendingMutations("biometric-kiosk"); // retried -- same event_id both times

    expect(submitScan).toHaveBeenNthCalledWith(1, samplePayload);
    expect(submitScan).toHaveBeenNthCalledWith(2, samplePayload);
    expect(await queueMod.getPendingMutations("biometric-kiosk")).toHaveLength(0);
  });

  it("does not cross-contaminate with a concurrently-queued attendance mutation on the same device", async () => {
    const submitScan = vi.fn().mockResolvedValue({ success: true, verification: "success", event_created: true });
    vi.doMock("@/lib/biometric/kiosk-client", () => ({ submitScan }));
    vi.doMock("@/app/(app)/attendance/actions", () => ({
      submitAttendance: vi.fn().mockResolvedValue({ success: true }),
    }));

    const { queueMod } = await freshModules();
    await queueMod.queueMutation("biometric-kiosk", "submitScan", samplePayload);
    await queueMod.queueMutation("attendance", "submitAttendance", { stream_id: "s1", attendance_date: "2026-01-01", marks: [] });

    const kioskResult = await queueMod.syncPendingMutations("biometric-kiosk");

    expect(kioskResult).toEqual({ synced: 1, failed: 0 });
    expect(await queueMod.getPendingMutations("attendance")).toHaveLength(1); // untouched by the scoped sync
  });
});
