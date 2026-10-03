import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const insert = vi.fn();
  const rpc = vi.fn();
  const from = vi.fn(() => ({ insert }));
  return {
    insert,
    rpc,
    from,
    createClient: vi.fn(),
    markIncompleteLeadCompleted: vi.fn(),
    sendSecurityAlert: vi.fn(),
  };
});

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: h.createClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: h.from, rpc: h.rpc }),
}));
vi.mock("@/lib/security-alert", () => ({ sendSecurityAlert: h.sendSecurityAlert }));
vi.mock("@/lib/marketing/demo-partial-store", () => ({
  markIncompleteLeadCompleted: h.markIncompleteLeadCompleted,
}));

const { submitDemoRequest } = await import("./actions");

function form(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const base: Record<string, string> = {
    name: "Jane Teacher",
    school_name: "Sunrise Academy",
    role: "Principal",
    email: "Jane@Sunrise.ac.ke",
    phone: "0700000000",
    student_count: "450",
    message: "Please demo",
    rendered_at: String(Date.now() - 10_000),
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}

describe("submitDemoRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.rpc.mockResolvedValue({ data: true, error: null });
    h.insert.mockResolvedValue({ error: null });
  });

  it("inserts through the admin client and never touches the anon client", async () => {
    const res = await submitDemoRequest({ status: "idle" }, form());
    expect(res).toEqual({ status: "success" });
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.from).toHaveBeenCalledWith("marketing_demo_requests");
    expect(h.insert).toHaveBeenCalledTimes(1);
    expect(h.insert.mock.calls[0][0]).toMatchObject({
      name: "Jane Teacher",
      school_name: "Sunrise Academy",
      role: "Principal",
      email: "Jane@Sunrise.ac.ke",
      phone: "0700000000",
      student_count: 450,
      message: "Please demo",
    });
    expect(h.markIncompleteLeadCompleted).toHaveBeenCalledTimes(1);
  });

  it("rate-limits by trusted IP before writing", async () => {
    await submitDemoRequest({ status: "idle" }, form());
    expect(h.rpc).toHaveBeenCalledWith("increment_and_check_rate_limit", {
      p_bucket: "demo-request:203.0.113.9",
      p_max_events: 5,
      p_window_seconds: 3600,
    });
  });

  it("does not insert when the rate limit is tripped", async () => {
    h.rpc.mockResolvedValue({ data: false, error: null });
    const res = await submitDemoRequest({ status: "idle" }, form());
    expect(res.status).toBe("error");
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("retries once with legacy attribution columns when a column is missing", async () => {
    h.insert
      .mockResolvedValueOnce({ error: { code: "42703" } })
      .mockResolvedValueOnce({ error: null });
    const res = await submitDemoRequest({ status: "idle" }, form());
    expect(res).toEqual({ status: "success" });
    expect(h.insert).toHaveBeenCalledTimes(2);
    expect(h.createClient).not.toHaveBeenCalled();
  });

  it("returns a friendly error and skips follow-up when the insert fails", async () => {
    h.insert.mockResolvedValue({ error: { code: "XX000", message: "boom" } });
    const res = await submitDemoRequest({ status: "idle" }, form());
    expect(res.status).toBe("error");
    expect(h.markIncompleteLeadCompleted).not.toHaveBeenCalled();
  });

  it("silently succeeds without writing for honeypot and too-fast submits", async () => {
    expect(
      await submitDemoRequest({ status: "idle" }, form({ company_website: "spam.com" })),
    ).toEqual({ status: "success" });
    expect(
      await submitDemoRequest({ status: "idle" }, form({ rendered_at: String(Date.now()) })),
    ).toEqual({ status: "success" });
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("validates required fields and email before any database call", async () => {
    expect((await submitDemoRequest({ status: "idle" }, form({ name: "" }))).status).toBe("error");
    expect((await submitDemoRequest({ status: "idle" }, form({ email: "nope" }))).status).toBe("error");
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.insert).not.toHaveBeenCalled();
  });
});
