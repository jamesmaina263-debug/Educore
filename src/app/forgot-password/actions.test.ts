import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const rpc = vi.fn();
  const resetPasswordForEmail = vi.fn();
  const sendSecurityAlert = vi.fn();
  const admin = { rpc };
  return { rpc, resetPasswordForEmail, sendSecurityAlert, admin };
});

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ "x-forwarded-for": "203.0.113.9", origin: "https://www.educoreafrica.com" }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.admin }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { resetPasswordForEmail: h.resetPasswordForEmail } }),
}));
vi.mock("@/lib/security-alert", () => ({ sendSecurityAlert: h.sendSecurityAlert }));

const { requestPasswordReset } = await import("./actions");
const { EMAIL_SEND_FAILED_MESSAGE } = await import("@/lib/auth/password-messages");

function form(email: string) {
  const fd = new FormData();
  fd.set("email", email);
  return fd;
}
const initial = { error: null, sent: false };

describe("requestPasswordReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.rpc.mockResolvedValue({ data: true });
    h.resetPasswordForEmail.mockResolvedValue({ error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("asks for an email when none is given", async () => {
    const res = await requestPasswordReset(initial, form("  "));
    expect(res).toEqual({ error: "Enter your email address.", sent: false });
    expect(h.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("reports sent when Supabase accepts the request", async () => {
    const res = await requestPasswordReset(initial, form("jane@sunrise.ac.ke"));
    expect(res).toEqual({ error: null, sent: true });
    expect(h.resetPasswordForEmail).toHaveBeenCalledOnce();
  });

  it("shows a real error instead of 'sent' when Supabase refuses to send", async () => {
    h.resetPasswordForEmail.mockResolvedValue({ error: { status: 429, code: "over_email_send_rate_limit" } });
    const res = await requestPasswordReset(initial, form("jane@sunrise.ac.ke"));
    expect(res).toEqual({ error: EMAIL_SEND_FAILED_MESSAGE, sent: false });
  });

  it("shows the same error if the send throws", async () => {
    h.resetPasswordForEmail.mockRejectedValue(new Error("network"));
    const res = await requestPasswordReset(initial, form("jane@sunrise.ac.ke"));
    expect(res).toEqual({ error: EMAIL_SEND_FAILED_MESSAGE, sent: false });
  });

  it("allows 30 requests per hour per IP and 3 per email", async () => {
    await requestPasswordReset(initial, form("Jane@Sunrise.ac.ke"));
    const calls = h.rpc.mock.calls.map((c) => c[1]);
    expect(calls).toContainEqual({ p_bucket: "password-reset-ip:203.0.113.9", p_max_events: 30, p_window_seconds: 3600 });
    expect(calls).toContainEqual({ p_bucket: "password-reset-email:jane@sunrise.ac.ke", p_max_events: 3, p_window_seconds: 3600 });
  });

  it("stays generic ('sent') and sends nothing when a rate limit trips", async () => {
    h.rpc.mockResolvedValue({ data: false });
    const res = await requestPasswordReset(initial, form("jane@sunrise.ac.ke"));
    expect(res).toEqual({ error: null, sent: true });
    expect(h.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(h.sendSecurityAlert).toHaveBeenCalled();
  });
});
