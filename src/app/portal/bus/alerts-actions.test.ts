import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { setMyBusAlerts } = await import("./alerts-actions");
const client = (rpcReply: unknown = { error: null }, user: unknown = { id: "u" }) => {
  const rpc = vi.fn().mockResolvedValue(rpcReply);
  return { c: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) }, rpc }, rpc };
};
beforeEach(() => vi.clearAllMocks());

describe("setMyBusAlerts", () => {
  it("rejects a non-boolean before touching Supabase", async () => {
    expect(await setMyBusAlerts("yes" as never)).toEqual({ error: "Invalid choice." });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
  it("requires sign-in", async () => {
    mockCreateClient.mockResolvedValue(client({}, null).c);
    expect(await setMyBusAlerts(false)).toEqual({ error: "Please sign in again." });
  });
  it("calls set_my_bus_alerts with the choice", async () => {
    const { c, rpc } = client();
    mockCreateClient.mockResolvedValue(c);
    expect(await setMyBusAlerts(false)).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("set_my_bus_alerts", { p_enabled: false });
  });
  it("maps refusals", async () => {
    mockCreateClient.mockResolvedValue(client({ error: { code: "55000", message: "x" } }).c);
    expect(await setMyBusAlerts(true)).toEqual({ error: expect.stringMatching(/switched off/) });
  });
});
