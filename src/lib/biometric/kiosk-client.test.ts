import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("fetchDeviceRoster", () => {
  it("sends the device key as a bearer token and returns the roster on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ device: { id: "d1", name: "Main Gate" }, roster: [{ credential_reference: "ref-1" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchDeviceRoster } = await import("./kiosk-client");
    const result = await fetchDeviceRoster("bio_abc.secret");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.supabase.co/functions/v1/biometric-verify",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer bio_abc.secret", apikey: "anon-key" }),
      }),
    );
    expect(result).toEqual({ deviceName: "Main Gate", roster: [{ credential_reference: "ref-1" }] });
  });

  it("surfaces a rejected/invalid device key as an error, not a thrown exception", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Unknown device." }) });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchDeviceRoster } = await import("./kiosk-client");
    const result = await fetchDeviceRoster("bio_bad.secret");

    expect(result).toEqual({ error: "Unknown device." });
  });

  it("reports a network failure distinctly (as 'network'), not the same as a rejected key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const { fetchDeviceRoster } = await import("./kiosk-client");
    const result = await fetchDeviceRoster("bio_abc.secret");

    expect(result).toEqual({ error: "network" });
  });
});

describe("submitScan", () => {
  const payload = {
    device_key: "bio_abc.secret",
    event_id: "evt-1",
    result: "success" as const,
    credential_reference: "ref-1",
    event_type: "check_in" as const,
    occurred_at: "2026-08-24T05:00:00.000Z",
    dry_run: false,
  };

  it("posts only event_id/result/credential_reference/event_type/occurred_at/dry_run -- never anything biometric", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, verification: "success", event_created: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { submitScan } = await import("./kiosk-client");
    await submitScan(payload);

    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body);
    expect(Object.keys(sentBody).sort()).toEqual(
      ["credential_reference", "dry_run", "event_id", "event_type", "occurred_at", "result"].sort(),
    );
    expect(sentBody.device_key).toBeUndefined(); // device key goes in the Authorization header only, never the body
  });

  it("re-throws a TypeError (network drop) rather than converting it to an { error } value -- syncPendingMutations relies on this to stop the pass and keep the mutation pending", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const { submitScan } = await import("./kiosk-client");
    await expect(submitScan(payload)).rejects.toBeInstanceOf(TypeError);
  });

  it("returns { error } (does not throw) for a server-reported rejection like a revoked credential", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "revoked_credential" }) }));

    const { submitScan } = await import("./kiosk-client");
    const result = await submitScan(payload);

    expect(result).toEqual({ error: "revoked_credential" });
  });
});

describe("buildScanPayload", () => {
  it("generates a fresh event_id and stamps occurred_at, carrying through result/credential/eventType/dryRun", async () => {
    const { buildScanPayload } = await import("./kiosk-client");
    const payload = buildScanPayload({
      deviceKey: "bio_abc.secret",
      result: "success",
      credentialReference: "ref-1",
      eventType: "check_out",
      dryRun: true,
    });

    expect(payload.device_key).toBe("bio_abc.secret");
    expect(payload.credential_reference).toBe("ref-1");
    expect(payload.event_type).toBe("check_out");
    expect(payload.dry_run).toBe(true);
    expect(payload.event_id).toBeTruthy();
    expect(new Date(payload.occurred_at).toString()).not.toBe("Invalid Date");
  });
});
