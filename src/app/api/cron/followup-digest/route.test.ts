import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendSecurityAlert = vi.fn();
vi.mock("@/lib/security-alert", () => ({ sendSecurityAlert: (...a: unknown[]) => sendSecurityAlert(...a) }));

import { GET } from "./route";

const fetchMock = vi.fn();
function call(auth?: string) {
  return GET(new Request("https://www.educoreafrica.com/api/cron/followup-digest", { headers: auth ? { authorization: auth } : {} }));
}

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret";
  process.env.DISPATCH_SECRET = "dispatch-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  sendSecurityAlert.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("GET /api/cron/followup-digest", () => {
  it("rejects a missing or wrong secret without calling the function", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports missing configuration", async () => {
    delete process.env.DISPATCH_SECRET;
    expect((await call("Bearer cron-secret")).status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the dispatch secret to the Edge Function and returns its result", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ sent: true, overdue: 8, due_today: 0 }), { status: 200 }));
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: true, overdue: 8 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.supabase.co/functions/v1/send-followup-digest");
    expect((init as RequestInit).headers).toMatchObject({ "x-dispatch-secret": "dispatch-secret" });
    expect(sendSecurityAlert).not.toHaveBeenCalled();
  });

  it("raises an alert and answers 502 when the function fails", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "RESEND_API_KEY missing" }), { status: 500 }));
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(502);
    expect(sendSecurityAlert).toHaveBeenCalledWith("Follow-up digest cron failed", { error: "RESEND_API_KEY missing" });
  });
});
