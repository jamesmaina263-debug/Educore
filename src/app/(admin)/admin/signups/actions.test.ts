import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const rpc = vi.fn();
  const client = { rpc };
  const logAdminAction = vi.fn();
  const revalidatePath = vi.fn();
  return { rpc, client, logAdminAction, revalidatePath };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: async () => {} }));
vi.mock("@/lib/log-admin-action", () => ({ logAdminAction: h.logAdminAction }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));

const { reviewSchoolSignup } = await import("./actions");

const SCHOOL = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.rpc.mockReset();
  h.logAdminAction.mockReset();
  h.revalidatePath.mockReset();
});

describe("reviewSchoolSignup", () => {
  it("rejects a bad school id or decision before touching the database", async () => {
    expect(await reviewSchoolSignup("nope", "approved")).toEqual({ error: "Invalid school." });
    expect(await reviewSchoolSignup(SCHOOL, "pending")).toEqual({ error: "Choose approve or reject." });
    expect(await reviewSchoolSignup(SCHOOL, "")).toEqual({ error: "Choose approve or reject." });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("approves through the RPC, audits who/what, and refreshes the pages", async () => {
    h.rpc.mockResolvedValue({ error: null });
    expect(await reviewSchoolSignup(SCHOOL, "approved")).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_review_school_signup", { p_school_id: SCHOOL, p_decision: "approved" });
    expect(h.logAdminAction).toHaveBeenCalledWith(h.client, "approve_school_signup", { school_id: SCHOOL });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/signups");
  });

  it("rejects through the RPC and audits it as a rejection", async () => {
    h.rpc.mockResolvedValue({ error: null });
    expect(await reviewSchoolSignup(SCHOOL, "rejected")).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_review_school_signup", { p_school_id: SCHOOL, p_decision: "rejected" });
    expect(h.logAdminAction).toHaveBeenCalledWith(h.client, "reject_school_signup", { school_id: SCHOOL });
  });

  it("returns the database's message and logs nothing when the RPC refuses", async () => {
    h.rpc.mockResolvedValue({ error: { message: "That school was not found, or it is not a signup waiting for review." } });
    expect(await reviewSchoolSignup(SCHOOL, "rejected")).toEqual({
      error: "That school was not found, or it is not a signup waiting for review.",
    });
    expect(h.logAdminAction).not.toHaveBeenCalled();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});
