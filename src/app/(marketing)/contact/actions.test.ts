import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const insert = vi.fn();
  const rpc = vi.fn();
  // Duplicate lookup: from().select().eq().eq().gte().limit() -> { data, error }
  const recent = vi.fn();
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte"]) chain[m] = () => chain;
  chain.limit = () => recent();
  const from = vi.fn(() => ({ insert, ...chain }));
  return {
    insert,
    recent,
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
const { WHATSAPP_CONSENT_LABEL } = await import("@/lib/marketing/demo-request");

function form(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const base: Record<string, string> = {
    name: "Jane Teacher",
    school_name: "Sunrise Academy",
    role: "Principal",
    email: "Jane@Sunrise.ac.ke",
    phone: "0700 000 000",
    contact_method: "whatsapp",
    request_type: "callback",
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
    h.recent.mockResolvedValue({ data: [], error: null });
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
      message: "Contact via: WhatsApp\nPreferred time: callback requested as soon as possible\n\nPlease demo",
    });
    expect(h.markIncompleteLeadCompleted).toHaveBeenCalledTimes(1);
  });

  it("stores the chosen school type in the existing message block, with no new column", async () => {
    const res = await submitDemoRequest({ status: "idle" }, form({ school_category: "junior-schools" }));
    expect(res).toEqual({ status: "success" });
    const row = h.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.message).toBe(
      "Contact via: WhatsApp\nPreferred time: callback requested as soon as possible\nSchool type: Junior school\n\nPlease demo",
    );
    expect(Object.keys(row)).not.toContain("school_category");
  });

  it("ignores an unrecognised school type rather than failing the visitor", async () => {
    const res = await submitDemoRequest({ status: "idle" }, form({ school_category: "not-a-type" }));
    expect(res).toEqual({ status: "success" });
    expect((h.insert.mock.calls[0][0] as { message: string }).message).not.toContain("School type");
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

  it("requires a phone number and a contact method", async () => {
    const noPhone = await submitDemoRequest({ status: "idle" }, form({ phone: "" }));
    expect(noPhone).toMatchObject({ status: "error", field: "phone" });
    const noMethod = await submitDemoRequest({ status: "idle" }, form({ contact_method: "" }));
    expect(noMethod).toMatchObject({ status: "error", field: "contact_method" });
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("rejects a role outside the offered list", async () => {
    const res = await submitDemoRequest({ status: "idle" }, form({ role: "<b>x</b>" }));
    expect(res).toMatchObject({ status: "error", field: "role" });
  });

  it("stores an unconfirmed preferred time in the message block", async () => {
    const res = await submitDemoRequest(
      { status: "idle" },
      form({ request_type: "scheduled", preferred_date: soon(), time_window: "afternoon" }),
    );
    expect(res).toEqual({ status: "success" });
    const stored = h.insert.mock.calls[0][0].message as string;
    expect(stored).toContain("Afternoon (12:00–17:00) EAT (NOT yet confirmed");
  });

  it("rejects a scheduled request in the past", async () => {
    const res = await submitDemoRequest(
      { status: "idle" },
      form({ request_type: "scheduled", preferred_date: "2020-01-01", time_window: "morning" }),
    );
    expect(res).toMatchObject({ status: "error", field: "preferred_date" });
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("treats a repeat of the same phone + school as already received, without a second insert", async () => {
    h.recent.mockResolvedValue({ data: [{ id: "abc" }], error: null });
    const res = await submitDemoRequest({ status: "idle" }, form());
    expect(res).toEqual({ status: "success" });
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("never reports success for a duplicate that was not actually stored", async () => {
    // Lookup finds nothing (the earlier attempt failed to save) -> the retry must insert.
    h.insert.mockResolvedValueOnce({ error: { code: "XX000", message: "boom" } });
    expect((await submitDemoRequest({ status: "idle" }, form())).status).toBe("error");
    h.insert.mockResolvedValueOnce({ error: null });
    expect((await submitDemoRequest({ status: "idle" }, form())).status).toBe("success");
    expect(h.insert).toHaveBeenCalledTimes(2);
  });

  it("still saves the lead if the duplicate lookup itself fails", async () => {
    h.recent.mockResolvedValue({ data: null, error: { message: "db down" } });
    const res = await submitDemoRequest({ status: "idle" }, form());
    expect(res).toEqual({ status: "success" });
    expect(h.insert).toHaveBeenCalledTimes(1);
  });
});

/** A valid preferred date: two days from now in Nairobi. */
function soon(): string {
  return new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

describe("submitDemoRequest: WhatsApp agreement", () => {
  const consentCalls = () => h.rpc.mock.calls.filter((c) => c[0] === "record_demo_whatsapp_consent");

  beforeEach(() => {
    vi.clearAllMocks();
    h.rpc.mockResolvedValue({ data: true, error: null });
    h.insert.mockResolvedValue({ error: null });
    h.recent.mockResolvedValue({ data: [], error: null });
  });

  it("records the agreement, with the exact words and this request's id, only when the box was ticked", async () => {
    const res = await submitDemoRequest({ status: "idle" }, form({ whatsapp_consent: "yes" }));
    expect(res).toEqual({ status: "success" });
    const savedId = h.insert.mock.calls[0][0].id as string;
    expect(savedId).toMatch(/^[0-9a-f-]{36}$/);
    expect(consentCalls()).toHaveLength(1);
    expect(consentCalls()[0][1]).toEqual({
      p_demo_request_id: savedId,
      p_name: "Jane Teacher",
      p_school_name: "Sunrise Academy",
      p_phone: "0700000000",
      p_consent_text: WHATSAPP_CONSENT_LABEL,
    });
  });

  it("never records an agreement when the box was not ticked, even if WhatsApp is the preferred method", async () => {
    await submitDemoRequest({ status: "idle" }, form({ contact_method: "whatsapp" }));
    expect(consentCalls()).toHaveLength(0);
    for (const v of ["on", "true", "1", ""]) {
      await submitDemoRequest({ status: "idle" }, form({ whatsapp_consent: v }));
    }
    expect(consentCalls()).toHaveLength(0);
  });

  it("still saves the lead and reports success when recording the agreement throws or errors", async () => {
    h.rpc.mockImplementation(async (name: string) => {
      if (name === "record_demo_whatsapp_consent") throw new Error("function does not exist");
      return { data: true, error: null };
    });
    expect(await submitDemoRequest({ status: "idle" }, form({ whatsapp_consent: "yes" }))).toEqual({ status: "success" });
    expect(h.insert).toHaveBeenCalledTimes(1);
    expect(h.markIncompleteLeadCompleted).toHaveBeenCalledTimes(1);

    h.rpc.mockImplementation(async (name: string) =>
      name === "record_demo_whatsapp_consent" ? { data: null, error: { message: "boom" } } : { data: true, error: null },
    );
    expect(await submitDemoRequest({ status: "idle" }, form({ whatsapp_consent: "yes" }))).toEqual({ status: "success" });
  });

  it("uses the same request id on the legacy-column retry, and records the agreement once", async () => {
    h.insert.mockResolvedValueOnce({ error: { code: "42703" } }).mockResolvedValueOnce({ error: null });
    expect(await submitDemoRequest({ status: "idle" }, form({ whatsapp_consent: "yes" }))).toEqual({ status: "success" });
    expect(h.insert).toHaveBeenCalledTimes(2);
    const first = h.insert.mock.calls[0][0].id;
    expect(h.insert.mock.calls[1][0].id).toBe(first);
    expect(consentCalls()).toHaveLength(1);
    expect(consentCalls()[0][1].p_demo_request_id).toBe(first);
  });

  it("records nothing when the lead was not saved, was a duplicate retry, or was a bot", async () => {
    h.insert.mockResolvedValue({ error: { code: "XX000", message: "boom" } });
    expect((await submitDemoRequest({ status: "idle" }, form({ whatsapp_consent: "yes" }))).status).toBe("error");
    h.insert.mockResolvedValue({ error: null });
    h.recent.mockResolvedValue({ data: [{ id: "x" }], error: null });
    expect(await submitDemoRequest({ status: "idle" }, form({ whatsapp_consent: "yes" }))).toEqual({ status: "success" });
    h.recent.mockResolvedValue({ data: [], error: null });
    await submitDemoRequest({ status: "idle" }, form({ whatsapp_consent: "yes", company_website: "spam.com" }));
    await submitDemoRequest({ status: "idle" }, form({ whatsapp_consent: "yes", rendered_at: String(Date.now()) }));
    expect(consentCalls()).toHaveLength(0);
  });
});
