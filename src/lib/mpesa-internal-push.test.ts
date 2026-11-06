import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchInternalStkPush } from "./mpesa-internal-push";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  process.env.DISPATCH_SECRET = "s3cret";
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("dispatchInternalStkPush", () => {
  it("calls the edge function with the dispatch secret (never an Authorization header)", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    expect(await dispatchInternalStkPush("req-1")).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://x.supabase.co/functions/v1/mpesa-stk-push");
    expect(init.headers["x-dispatch-secret"]).toBe("s3cret");
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ request_id: "req-1" });
  });
  it("does not call anything when not configured", async () => {
    delete process.env.DISPATCH_SECRET;
    expect(await dispatchInternalStkPush("r")).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("reports a rejection with its status and a network failure", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
    expect(await dispatchInternalStkPush("r")).toEqual({ ok: false, reason: "rejected", status: 404 });
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await dispatchInternalStkPush("r")).toEqual({ ok: false, reason: "network" });
  });
});
