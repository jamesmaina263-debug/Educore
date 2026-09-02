import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function freshModules() {
  vi.resetModules();
  const dbMod = await import("./db");
  const cryptoMod = await import("./crypto");
  return { dbMod, cryptoMod };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe("OS-10 device-key encryption", () => {
  it("round-trips a value through putEncrypted/getEncrypted unchanged", async () => {
    const { dbMod, cryptoMod } = await freshModules();
    const record = { key: "cache:1", value: { name: "Amina W.", note: "sensitive" } };
    await cryptoMod.putEncrypted(dbMod.STORES.cachedReads, record, "value");
    const result = await cryptoMod.getEncrypted<typeof record>(dbMod.STORES.cachedReads, "cache:1", "value");
    expect(result?.value).toEqual({ name: "Amina W.", note: "sensitive" });
  });

  it("round-trips a batch through putEncrypted/getAllEncrypted and getAllByIndexEncrypted", async () => {
    const { dbMod, cryptoMod } = await freshModules();
    await cryptoMod.putEncrypted(
      dbMod.STORES.pendingMutations,
      { id: "m1", module: "health", type: "checkIn", payload: { student_id: "s1", note: "fever" } },
      "payload",
    );
    await cryptoMod.putEncrypted(
      dbMod.STORES.pendingMutations,
      { id: "m2", module: "attendance", type: "submit", payload: { marks: [1, 0, 1] } },
      "payload",
    );

    const all = await cryptoMod.getAllEncrypted<{ id: string; module: string; payload: unknown }>(dbMod.STORES.pendingMutations, "payload");
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.id === "m1")?.payload).toEqual({ student_id: "s1", note: "fever" });

    const scoped = await cryptoMod.getAllByIndexEncrypted<{ id: string; module: string; payload: unknown }>(
      dbMod.STORES.pendingMutations,
      "by_module",
      "attendance",
      "payload",
    );
    expect(scoped).toHaveLength(1);
    expect(scoped[0].payload).toEqual({ marks: [1, 0, 1] });
  });

  it("actually stores the field encrypted, not plaintext, on disk", async () => {
    const { dbMod, cryptoMod } = await freshModules();
    const secret = "this exact string must never appear in the raw stored record";
    await cryptoMod.putEncrypted(dbMod.STORES.cachedReads, { key: "cache:2", value: secret }, "value");

    // Read the raw record straight from IndexedDB, bypassing decryption entirely, to prove
    // the plaintext isn't sitting on disk as-is.
    const raw = await dbMod.idbGet<{ key: string; value: unknown }>(dbMod.STORES.cachedReads, "cache:2");
    expect(JSON.stringify(raw)).not.toContain(secret);
    expect(raw?.value).toMatchObject({ __enc: true });
  });

  it("treats a pre-OS-10 plaintext record as already-decrypted (backward compatible)", async () => {
    const { dbMod, cryptoMod } = await freshModules();
    // Simulates a mutation queued by an app version from before this change shipped --
    // written with the raw idb* functions, no encryption wrapper involved.
    await dbMod.idbPut(dbMod.STORES.pendingMutations, { id: "legacy-1", module: "attendance", type: "submit", payload: { marks: [1, 1] } });

    const result = await cryptoMod.getEncrypted<{ id: string; payload: unknown }>(dbMod.STORES.pendingMutations, "legacy-1", "payload");
    expect(result?.payload).toEqual({ marks: [1, 1] });
  });

  it("returns undefined for the field, not a thrown error, if decryption fails", async () => {
    const { dbMod, cryptoMod } = await freshModules();
    // A record whose __enc wrapper is malformed -- e.g. corrupted storage, or (in principle)
    // ciphertext from a different device's key finding its way onto this one.
    await dbMod.idbPut(dbMod.STORES.cachedReads, { key: "cache:3", value: { __enc: true, iv: "not-valid-base64!!", ct: "also-not-valid!!" } });

    await expect(cryptoMod.getEncrypted<{ key: string; value: unknown }>(dbMod.STORES.cachedReads, "cache:3", "value")).resolves.toMatchObject({
      value: undefined,
    });
  });

  it("uses a distinct IV per encryption, so the same plaintext never produces identical ciphertext twice", async () => {
    const { dbMod, cryptoMod } = await freshModules();
    await cryptoMod.putEncrypted(dbMod.STORES.cachedReads, { key: "cache:4", value: "same value" }, "value");
    await cryptoMod.putEncrypted(dbMod.STORES.cachedReads, { key: "cache:5", value: "same value" }, "value");

    const a = await dbMod.idbGet<{ value: { ct: string } }>(dbMod.STORES.cachedReads, "cache:4");
    const b = await dbMod.idbGet<{ value: { ct: string } }>(dbMod.STORES.cachedReads, "cache:5");
    expect(a?.value.ct).not.toEqual(b?.value.ct);
  });
});
