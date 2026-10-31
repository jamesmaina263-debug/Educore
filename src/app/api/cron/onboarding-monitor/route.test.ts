import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendSecurityAlert = vi.fn();
vi.mock("@/lib/security-alert", () => ({ sendSecurityAlert: (...a: unknown[]) => sendSecurityAlert(...a) }));

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { GET } from "./route";

const fetchMock = vi.fn();
const SECRET = "s".repeat(40);

function call(auth?: string) {
  return GET(new Request("https://www.educoreafrica.com/api/cron/onboarding-monitor", { headers: auth ? { authorization: auth } : {} }));
}

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret";
  delete process.env.EXTERNAL_CRON_SECRET;
  process.env.ONBOARDING_SEND_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  rpc.mockReset();
  sendSecurityAlert.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

function rulesThenPending(pending: { nudge_id: string }[]) {
  rpc.mockImplementation(async (name: string) => {
    if (name === "onboarding_run_rules") return { data: { alerts_created: 1, alerts_resolved: 0, emails_queued: pending.length }, error: null };
    if (name === "onboarding_pending_sends") return { data: pending, error: null };
    return { data: null, error: { message: `unexpected rpc ${name}` } };
  });
}

describe("GET /api/cron/onboarding-monitor", () => {
  it("rejects a missing or wrong secret without touching the database", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs alerts only, and queues nothing, when the send secret is not configured", async () => {
    delete process.env.ONBOARDING_SEND_SECRET;
    rulesThenPending([]);
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("onboarding_run_rules", { p_queue_emails: false });
    expect(rpc).not.toHaveBeenCalledWith("onboarding_pending_sends", expect.anything());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ send_configured: false, queued_found: 0 });
  });

  it("treats a too-short send secret as not configured", async () => {
    process.env.ONBOARDING_SEND_SECRET = "short";
    rulesThenPending([]);
    await call("Bearer cron-secret");
    expect(rpc).toHaveBeenCalledWith("onboarding_run_rules", { p_queue_emails: false });
  });

  it("hands each queued message to the Edge Function by nudge id only, with the shared secret", async () => {
    rulesThenPending([{ nudge_id: "11111111-1111-1111-1111-111111111111" }]);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ sent: 1, failed: 0, remaining: 0 }), { status: 200 }));
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("onboarding_run_rules", { p_queue_emails: true });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.supabase.co/functions/v1/send-owner-campaign");
    expect(init.headers).toMatchObject({ "x-onboarding-send-secret": SECRET, Authorization: "Bearer service-key" });
    expect(JSON.parse(String(init.body))).toEqual({ onboarding_nudge_id: "11111111-1111-1111-1111-111111111111" });

    const json = await res.json();
    expect(json.send_outcomes).toEqual({ sent: 1, cancelled: 0, pending: 0, error: 0 });
    expect(sendSecurityAlert).not.toHaveBeenCalled();
  });

  it("counts a safety cancellation as cancelled, not as an error", async () => {
    rulesThenPending([{ nudge_id: "22222222-2222-2222-2222-222222222222" }]);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ sent: 0, failed: 0, remaining: 0, cancelled: "password_already_changed" }), { status: 200 }),
    );
    const json = await (await call("Bearer cron-secret")).json();
    expect(json.send_outcomes).toEqual({ sent: 0, cancelled: 1, pending: 0, error: 0 });
    expect(sendSecurityAlert).not.toHaveBeenCalled();
  });

  it("raises an alert when sends fail, and never includes addresses or message text in the response", async () => {
    rulesThenPending([{ nudge_id: "33333333-3333-3333-3333-333333333333" }]);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(200);
    expect((await res.json()).send_outcomes.error).toBe(1);
    expect(sendSecurityAlert).toHaveBeenCalledWith("Onboarding monitor could not send some automatic emails", { failed: "1", attempted: "1" });
  });

  it("answers 500 and alerts when the rules run itself fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(500);
    expect(sendSecurityAlert).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
