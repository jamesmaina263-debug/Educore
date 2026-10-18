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

const { logTrialCheckin } = await import("./actions");

const SCHOOL = "11111111-1111-4111-8111-111111111111";
const REP = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  h.rpc.mockReset();
  h.logAdminAction.mockReset();
  h.revalidatePath.mockReset();
});

describe("logTrialCheckin", () => {
  it("rejects bad input before touching the database", async () => {
    expect(await logTrialCheckin("nope", "call", "no_answer", null)).toEqual({ error: "Invalid school id." });
    expect(await logTrialCheckin(SCHOOL, "call", "no_answer", "nope")).toEqual({ error: "Invalid team member." });
    expect(await logTrialCheckin(SCHOOL, "telegram", "no_answer", null)).toEqual({ error: "Unknown channel." });
    expect(await logTrialCheckin(SCHOOL, "call", "converted", null)).toEqual({ error: "Unknown outcome." });
    expect(await logTrialCheckin(SCHOOL, "call", "no_answer", null, "x".repeat(501))).toMatchObject({ error: expect.any(String) });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.logAdminAction).not.toHaveBeenCalled();
  });

  it("calls the RPC with the checked values and audits ids and codes only (never the note)", async () => {
    h.rpc.mockResolvedValue({ data: "row-id", error: null });
    expect(await logTrialCheckin(SCHOOL, "whatsapp", "message_left", REP, "  asked for a call back  ")).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_log_trial_checkin", {
      p_school_id: SCHOOL,
      p_channel: "whatsapp",
      p_outcome: "message_left",
      p_performed_by: REP,
      p_note: "asked for a call back",
    });
    expect(h.logAdminAction).toHaveBeenCalledWith(h.client, "log_trial_checkin", {
      school_id: SCHOOL,
      channel: "whatsapp",
      outcome: "message_left",
    });
    expect(JSON.stringify(h.logAdminAction.mock.calls)).not.toContain("call back");
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/trials");
  });

  it("returns the database's message and logs nothing when the RPC fails", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "Not authorized to log trial check-ins." } });
    expect(await logTrialCheckin(SCHOOL, "call", "no_answer", null)).toEqual({ error: "Not authorized to log trial check-ins." });
    expect(h.logAdminAction).not.toHaveBeenCalled();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});
