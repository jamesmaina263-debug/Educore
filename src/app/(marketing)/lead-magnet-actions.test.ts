import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const insert = vi.fn();
  const rpc = vi.fn();
  const from = vi.fn(() => ({ insert }));
  return { insert, rpc, from, createClient: vi.fn(), sendSecurityAlert: vi.fn() };
});

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.7" }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: h.createClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: h.from, rpc: h.rpc }),
}));
vi.mock("@/lib/security-alert", () => ({ sendSecurityAlert: h.sendSecurityAlert }));

const { submitLeadMagnet } = await import("./lead-magnet-actions");

function form(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const base: Record<string, string> = {
    email: "  Reader@School.ac.ke ",
    name: "Reader",
    resource: "cbc_digital_readiness_checklist",
    source_page: "/blog/cbc",
    rendered_at: String(Date.now() - 10_000),
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}

describe("submitLeadMagnet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.rpc.mockResolvedValue({ data: true, error: null });
    h.insert.mockResolvedValue({ error: null });
  });

  it("inserts through the admin client and never touches the anon client", async () => {
    expect(await submitLeadMagnet({ status: "idle" }, form())).toEqual({ status: "success" });
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.from).toHaveBeenCalledWith("marketing_leads");
    expect(h.insert.mock.calls[0][0]).toMatchObject({
      email: "reader@school.ac.ke",
      name: "Reader",
      resource: "cbc_digital_readiness_checklist",
      source_page: "/blog/cbc",
    });
  });

  it("rate-limits by trusted IP in its own bucket", async () => {
    await submitLeadMagnet({ status: "idle" }, form());
    expect(h.rpc).toHaveBeenCalledWith("increment_and_check_rate_limit", {
      p_bucket: "lead-magnet:198.51.100.7",
      p_max_events: 8,
      p_window_seconds: 3600,
    });
  });

  it("does not insert when the rate limit is tripped", async () => {
    h.rpc.mockResolvedValue({ data: false, error: null });
    expect((await submitLeadMagnet({ status: "idle" }, form())).status).toBe("error");
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("treats a duplicate email (23505) as success, same as a fresh signup", async () => {
    h.insert.mockResolvedValue({ error: { code: "23505" } });
    expect(await submitLeadMagnet({ status: "idle" }, form())).toEqual({ status: "success" });
  });

  it("retries once with legacy columns when a column is missing", async () => {
    h.insert
      .mockResolvedValueOnce({ error: { code: "42703" } })
      .mockResolvedValueOnce({ error: null });
    expect(await submitLeadMagnet({ status: "idle" }, form())).toEqual({ status: "success" });
    expect(h.insert).toHaveBeenCalledTimes(2);
    expect(h.createClient).not.toHaveBeenCalled();
  });

  it("returns a friendly error for any other insert failure", async () => {
    h.insert.mockResolvedValue({ error: { code: "XX000" } });
    expect((await submitLeadMagnet({ status: "idle" }, form())).status).toBe("error");
  });

  it("silently succeeds without writing for honeypot and too-fast submits", async () => {
    expect(await submitLeadMagnet({ status: "idle" }, form({ company_website: "x.com" }))).toEqual({ status: "success" });
    expect(await submitLeadMagnet({ status: "idle" }, form({ rendered_at: String(Date.now()) }))).toEqual({ status: "success" });
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("validates email before any database call", async () => {
    expect((await submitLeadMagnet({ status: "idle" }, form({ email: "" }))).status).toBe("error");
    expect((await submitLeadMagnet({ status: "idle" }, form({ email: "nope" }))).status).toBe("error");
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
