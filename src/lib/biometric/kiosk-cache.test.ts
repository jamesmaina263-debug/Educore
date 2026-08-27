import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function freshModules() {
  vi.resetModules();
  return import("./kiosk-cache");
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

const roster = [{ credential_reference: "ref-1", credential_type: "fingerprint" as const, person_type: "student" as const, person_name: "Amina W." }];

describe("kiosk roster cache", () => {
  it("round-trips a cached roster for the same device key", async () => {
    const { cacheRoster, getCachedRoster } = await freshModules();
    await cacheRoster("bio_abc12345.secret", "Main Gate", roster);

    const cached = await getCachedRoster("bio_abc12345.secret");
    expect(cached?.deviceName).toBe("Main Gate");
    expect(cached?.roster).toEqual(roster);
  });

  it("scopes the cache by device key prefix, not the full secret", async () => {
    const { cacheRoster, getCachedRoster, devicePrefixOf } = await freshModules();
    await cacheRoster("bio_abc12345.secret-one", "Main Gate", roster);

    // Same prefix, different secret (e.g. a rotated key) -- still resolves,
    // since the cache is keyed on the device identity, not the credential.
    expect(devicePrefixOf("bio_abc12345.secret-one")).toBe("bio_abc12345");
    const cached = await getCachedRoster("bio_abc12345.secret-two");
    expect(cached?.deviceName).toBe("Main Gate");
  });

  it("returns null (not a throw) for a device that has never been cached", async () => {
    const { getCachedRoster } = await freshModules();
    expect(await getCachedRoster("bio_never12345.secret")).toBeNull();
  });

  it("does not mix roster data between two different devices", async () => {
    const { cacheRoster, getCachedRoster } = await freshModules();
    await cacheRoster("bio_gate1abc.secret", "Main Gate", roster);
    await cacheRoster("bio_gate2xyz.secret", "Side Gate", []);

    expect((await getCachedRoster("bio_gate1abc.secret"))?.deviceName).toBe("Main Gate");
    expect((await getCachedRoster("bio_gate2xyz.secret"))?.roster).toEqual([]);
  });
});
