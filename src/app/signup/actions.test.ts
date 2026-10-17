import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const calls: { table: string; op: string; row?: Record<string, unknown> }[] = [];
  const results: Record<string, unknown> = {};
  const createUser = vi.fn();
  const deleteUser = vi.fn();
  const rpc = vi.fn();
  const resetPasswordForEmail = vi.fn();
  const verifyTurnstileToken = vi.fn();
  const sendSecurityAlert = vi.fn();
  const state = { origin: "https://www.educoreafrica.com" };

  function builder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) b[m] = () => b;
    b.maybeSingle = async () => results[`${table}.maybeSingle`];
    b.single = async () => results[`${table}.single`];
    b.insert = (row: Record<string, unknown>) => {
      calls.push({ table, op: "insert", row });
      return Object.assign(Promise.resolve(results[`${table}.insert`] ?? { error: null }), { select: () => b });
    };
    b.delete = () => {
      calls.push({ table, op: "delete" });
      return { eq: async () => results[`${table}.delete`] ?? { error: null } };
    };
    return b;
  }
  const admin = { from: (t: string) => builder(t), rpc, auth: { admin: { createUser, deleteUser } } };
  return { state, calls, results, createUser, deleteUser, rpc, resetPasswordForEmail, verifyTurnstileToken, sendSecurityAlert, admin };
});

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9", origin: h.state.origin }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.admin }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { resetPasswordForEmail: h.resetPasswordForEmail } }),
}));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstileToken: h.verifyTurnstileToken }));
vi.mock("@/lib/security-alert", () => ({ sendSecurityAlert: h.sendSecurityAlert }));

const { signUpSchool } = await import("./actions");

function form(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const base: Record<string, string> = {
    owner_name: "Jane Wanjiru",
    school_name: "Sunrise Academy",
    phone: "0712 345 678",
    email: "jane@sunrise.ac.ke",
    country_code: "KE",
    form_loaded_at: String(Date.now() - 10_000),
    "cf-turnstile-response": "tok",
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}
const inserted = (table: string) => h.calls.find((c) => c.table === table && c.op === "insert")?.row;

describe("signUpSchool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.calls.length = 0;
    for (const k of Object.keys(h.results)) delete h.results[k];
    h.rpc.mockImplementation(async (name: string) => (name === "increment_and_check_rate_limit" ? { data: true } : { error: null }));
    h.verifyTurnstileToken.mockResolvedValue(true);
    h.createUser.mockResolvedValue({ data: { user: { id: "abcdef123456" } }, error: null });
    h.resetPasswordForEmail.mockResolvedValue({ error: null });
    h.deleteUser.mockResolvedValue({ error: null });
    h.results["subscription_plans.maybeSingle"] = { data: { id: "p1", code: "starter" } };
    h.results["schools.single"] = { data: { id: "s1" }, error: null };
    h.results["roles.single"] = { data: { id: "r1" } };
  });

  it("creates the school from the five required fields, with country-derived defaults", async () => {
    const res = await signUpSchool({ error: null }, form());
    expect(res).toEqual({ error: null, success: true, schoolName: "Sunrise Academy", email: "jane@sunrise.ac.ke", emailSent: true });
    expect(inserted("schools")).toMatchObject({
      name: "Sunrise Academy",
      status: "trial",
      phone: "+254712345678",
      email: "jane@sunrise.ac.ke",
      country_code: "KE",
      currency_code: "KES",
      gmt_timezone: "Africa/Nairobi",
      school_type: null,
      address: null,
    });
    expect(h.rpc).toHaveBeenCalledWith("start_trial_subscription", { p_school_id: "s1", p_plan_id: "p1", p_trial_days: 30 });
  });

  it("never returns or emails a password; the owner sets their own via the reset link", async () => {
    const res = await signUpSchool({ error: null }, form());
    expect(JSON.stringify(res)).not.toMatch(/password/i);
    expect(h.createUser.mock.calls[0][0]).toMatchObject({ email: "jane@sunrise.ac.ke", email_confirm: true });
    expect(String(h.createUser.mock.calls[0][0].password).length).toBeGreaterThanOrEqual(10);
    expect(inserted("school_users")).toMatchObject({ must_change_password: false, temp_password_expires_at: null, role_id: "r1" });
    expect(h.resetPasswordForEmail).toHaveBeenCalledWith("jane@sunrise.ac.ke", {
      redirectTo: "https://www.educoreafrica.com/auth/confirm?next=/reset-password",
    });
  });

  it("always uses the canonical origin in production, whatever address the request came from", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    h.state.origin = "https://educore-beige.vercel.app";
    try {
      await signUpSchool({ error: null }, form());
      expect(h.resetPasswordForEmail.mock.calls[0][1].redirectTo).toMatch(
        /^https:\/\/www\.educoreafrica\.com\/auth\/confirm\?next=\/reset-password$/,
      );
    } finally {
      vi.unstubAllEnvs();
      h.state.origin = "https://www.educoreafrica.com";
    }
  });

  it("still succeeds, and says the email failed, when the set-password email cannot be sent", async () => {
    h.resetPasswordForEmail.mockResolvedValue({ error: { status: 429 } });
    const res = await signUpSchool({ error: null }, form());
    expect(res).toMatchObject({ success: true, emailSent: false });
    expect(h.deleteUser).not.toHaveBeenCalled();
  });

  it("treats a thrown email error the same way", async () => {
    h.resetPasswordForEmail.mockRejectedValue(new Error("smtp down"));
    expect(await signUpSchool({ error: null }, form())).toMatchObject({ success: true, emailSent: false });
  });

  it.each([
    ["owner_name", "Your Name"],
    ["school_name", "Institution Name"],
    ["phone", "Phone"],
    ["email", "Email"],
    ["country_code", "Country"],
  ])("requires %s", async (field, label) => {
    const res = await signUpSchool({ error: null }, form({ [field]: "  " }));
    expect(res.error).toContain(label);
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("accepts the numbers that were valid before this change (no regression)", async () => {
    const res = await signUpSchool({ error: null }, form({ phone: "+447911123456" }));
    expect(res.success).toBe(true);
    expect(inserted("schools")).toMatchObject({ phone: "+447911123456" });
  });

  it.each(["abc", "12345", "0812345678"])("rejects phone %s before creating anything", async (phone) => {
    const res = await signUpSchool({ error: null }, form({ phone }));
    expect(res.error).toMatch(/valid phone/i);
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("rejects an invalid email and an invalid optional title", async () => {
    expect((await signUpSchool({ error: null }, form({ email: "nope" }))).error).toMatch(/valid email/i);
    expect((await signUpSchool({ error: null }, form({ title: "Emperor" }))).error).toMatch(/valid title/i);
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("rejects a disposable email address before creating anything", async () => {
    const res = await signUpSchool({ error: null }, form({ email: "wanjiru@mailinator.com" }));
    expect(res.error).toMatch(/school's own email/i);
    expect(res.success).toBeUndefined();
    expect(h.createUser).not.toHaveBeenCalled();
    expect(inserted("schools")).toBeUndefined();
  });

  it("gives a helpful message when the email already has an account", async () => {
    h.createUser.mockResolvedValue({ data: { user: null }, error: { message: "A user with this email address has already been registered" } });
    const res = await signUpSchool({ error: null }, form());
    expect(res.error).toMatch(/already exists.*Forgot password/i);
    expect(inserted("schools")).toBeUndefined();
  });

  it("shows a readable message, and rolls back, when the phone number is already taken", async () => {
    h.results["school_users.insert"] = {
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "uq_school_users_active_phone"',
      },
    };
    const res = await signUpSchool({ error: null }, form());
    expect(res.error).toMatch(/phone number is already registered/i);
    expect(res.error).not.toMatch(/duplicate key|constraint|uq_/i);
    expect(h.deleteUser).toHaveBeenCalledWith("abcdef123456");
    expect(h.calls.filter((c) => c.op === "delete").map((c) => c.table)).toContain("schools");
    expect(h.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("removes the school's seeded rows before the school itself when rolling back", async () => {
    h.results["school_users.insert"] = { error: { code: "23505", message: "uq_school_users_active_phone" } };
    await signUpSchool({ error: null }, form());
    const order = h.calls.filter((c) => c.op === "delete").map((c) => c.table);
    expect(order.indexOf("inventory_items")).toBeLessThan(order.indexOf("schools"));
    expect(order.indexOf("inventory_categories")).toBeLessThan(order.indexOf("schools"));
  });

  it("still removes the auth user, logs, and returns the original error when the school delete fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    h.results["school_users.insert"] = { error: { code: "23505", message: "uq_school_users_active_phone" } };
    h.results["schools.delete"] = { error: { message: "violates foreign key constraint" } };
    const res = await signUpSchool({ error: null }, form());
    expect(res.error).toMatch(/phone number is already registered/i);
    expect(h.deleteUser).toHaveBeenCalledWith("abcdef123456");
    expect(logged).toHaveBeenCalledWith("signup rollback incomplete", expect.objectContaining({ schoolId: "s1" }));
    logged.mockRestore();
  });

  it("fakes success for a honeypot hit without creating anything", async () => {
    const res = await signUpSchool({ error: null }, form({ company_website: "spam.com" }));
    expect(res).toMatchObject({ success: true, honeypot: true });
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("blocks submissions faster than a human, over the rate limit, or failing CAPTCHA", async () => {
    expect((await signUpSchool({ error: null }, form({ form_loaded_at: String(Date.now()) }))).error).toBeTruthy();
    h.rpc.mockResolvedValue({ data: false });
    expect((await signUpSchool({ error: null }, form())).error).toMatch(/too many/i);
    expect(h.sendSecurityAlert).toHaveBeenCalled();
    h.rpc.mockResolvedValue({ data: true });
    h.verifyTurnstileToken.mockResolvedValue(false);
    expect((await signUpSchool({ error: null }, form())).error).toMatch(/captcha/i);
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("rolls back the user, school and membership if the trial cannot start", async () => {
    h.rpc.mockImplementation(async (name: string) =>
      name === "start_trial_subscription" ? { error: { message: "trial failed" } } : { data: true },
    );
    const res = await signUpSchool({ error: null }, form());
    expect(res.error).toBe("trial failed");
    expect(h.deleteUser).toHaveBeenCalledWith("abcdef123456");
    expect(h.calls.filter((c) => c.op === "delete").map((c) => c.table).sort()).toEqual([
      "inventory_categories",
      "inventory_items",
      "school_subscriptions",
      "school_users",
      "schools",
    ]);
    expect(h.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
