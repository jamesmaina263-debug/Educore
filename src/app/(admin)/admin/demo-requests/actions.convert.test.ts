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

const { convertDemoRequestToLead } = await import("./actions");

const REQ = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  h.rpc.mockReset();
  h.logAdminAction.mockReset();
  h.revalidatePath.mockReset();
});

describe("convertDemoRequestToLead", () => {
  it("rejects a bad id before touching the database", async () => {
    expect(await convertDemoRequestToLead("nope")).toEqual({ error: "Invalid demo request id." });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("creates a lead, words the outcome, audits ids only and refreshes both pages", async () => {
    h.rpc.mockResolvedValue({ data: { lead_id: LEAD, created: true, already_linked: false, lead_name: "Sunrise" }, error: null });
    const r = await convertDemoRequestToLead(REQ);
    expect(r).toEqual({ success: true, leadId: LEAD, message: expect.stringContaining("Added to the sales pipeline") });
    expect(h.rpc).toHaveBeenCalledWith("admin_convert_demo_request_to_lead", { p_request_id: REQ });
    expect(h.logAdminAction).toHaveBeenCalledWith(h.client, "convert_demo_request_to_lead", {
      request_id: REQ,
      lead_id: LEAD,
      created: true,
    });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/demo-requests");
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/sales-pipeline");
  });

  it("says so when it linked to an existing lead instead of duplicating", async () => {
    h.rpc.mockResolvedValue({ data: { lead_id: LEAD, created: false, already_linked: false, lead_name: "Sunrise" }, error: null });
    const r = await convertDemoRequestToLead(REQ);
    expect(r).toMatchObject({ success: true, message: expect.stringContaining('existing lead "Sunrise"') });
  });

  it("passes the database's refusal through and records nothing", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "Not authorized to manage demo requests." } });
    expect(await convertDemoRequestToLead(REQ)).toEqual({ error: "Not authorized to manage demo requests." });
    expect(h.logAdminAction).not.toHaveBeenCalled();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not claim success on a malformed response", async () => {
    h.rpc.mockResolvedValue({ data: { created: true }, error: null });
    const r = await convertDemoRequestToLead(REQ);
    expect(r).toHaveProperty("error");
    expect(h.logAdminAction).not.toHaveBeenCalled();
  });
});
