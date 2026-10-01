import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { dispatchQueuedCommunications } from "./dispatch-communications-client";

describe("dispatchQueuedCommunications", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.DISPATCH_SECRET = "test-secret";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("sends the secret in x-dispatch-secret and no Authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ total: 3, sent: 3, failed: 0 }), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await dispatchQueuedCommunications();

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ total: 3, sent: 3 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.supabase.co/functions/v1/send-communication");
    expect(init.headers["x-dispatch-secret"]).toBe("test-secret");
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("maps a 401 to error.context.status so the transient-auth retry still recognises it", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "nope" }), { status: 401 })) as unknown as typeof fetch;
    const result = await dispatchQueuedCommunications();
    expect(result.data).toBeNull();
    expect(result.error?.context.status).toBe(401);
  });

  it("returns a 500-style error when the secret is not configured", async () => {
    delete process.env.DISPATCH_SECRET;
    const result = await dispatchQueuedCommunications();
    expect(result.error?.context.status).toBe(500);
  });

  it("returns a 502-style error on network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch;
    const result = await dispatchQueuedCommunications();
    expect(result.error).toEqual({ message: "boom", context: { status: 502 } });
  });
});
