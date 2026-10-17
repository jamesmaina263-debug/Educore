import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const rpc = vi.fn();
  const results: Record<string, unknown> = {};
  const tables: string[] = [];
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) b[m] = () => b;
    b.maybeSingle = async () => results[`${table}.maybeSingle`];
    // the contact log is read as a list (awaited after .limit())
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(results[`${table}.list`]).then(res);
    return b;
  }
  const client = { from: (t: string) => (tables.push(t), builder(t)), rpc };
  const logAdminAction = vi.fn();
  return { rpc, results, tables, client, logAdminAction };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: async () => {} }));
vi.mock("@/lib/log-admin-action", () => ({ logAdminAction: h.logAdminAction }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { loadProspectContact, logOutboundContact, recordProspectOptOut } = await import("./actions");

const ID = "11111111-1111-4111-8111-111111111111";
const REP = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  h.rpc.mockReset();
  h.logAdminAction.mockReset();
  h.tables.length = 0;
  for (const k of Object.keys(h.results)) delete h.results[k];
});

describe("logOutboundContact", () => {
  it("rejects bad input before touching the database", async () => {
    expect(await logOutboundContact("nope", "email", "sent", null)).toEqual({ error: "Invalid prospect id." });
    expect(await logOutboundContact(ID, "email", "sent", "nope")).toEqual({ error: "Invalid team member." });
    expect(await logOutboundContact(ID, "telegram", "sent", null)).toEqual({ error: "Unknown channel." });
    // opted_out is written only by the opt-out function, never from this action
    expect(await logOutboundContact(ID, "email", "opted_out", null)).toEqual({ error: "Unknown event." });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("calls the RPC with the checked values and audits ids only", async () => {
    h.rpc.mockResolvedValue({ data: "log-id", error: null });
    expect(await logOutboundContact(ID, "whatsapp", "draft_copied", REP, "  hi  ")).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_log_outbound_contact", {
      p_prospect_id: ID,
      p_channel: "whatsapp",
      p_event: "draft_copied",
      p_performed_by: REP,
      p_note: "hi",
    });
    expect(h.logAdminAction).toHaveBeenCalledWith(h.client, "log_outbound_contact", {
      prospect_id: ID,
      channel: "whatsapp",
      event: "draft_copied",
    });
  });

  it("passes the database's refusal through and logs nothing", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "This contact has opted out and must not be contacted." } });
    expect(await logOutboundContact(ID, "email", "sent", null)).toEqual({
      error: "This contact has opted out and must not be contacted.",
    });
    expect(h.logAdminAction).not.toHaveBeenCalled();
  });
});

describe("recordProspectOptOut", () => {
  it("validates input", async () => {
    expect(await recordProspectOptOut("nope", "email", "stop_reply")).toEqual({ error: "Invalid prospect id." });
    expect(await recordProspectOptOut(ID, "sms", "stop_reply")).toEqual({ error: "Unknown channel." });
    expect(await recordProspectOptOut(ID, "email", "manual")).toEqual({ error: "Invalid reason." });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("opts out the prospect's own number read on the server, and audits without the number", async () => {
    h.results["outbound_prospects.maybeSingle"] = { data: { email: "head@school.invalid", phone: "0712 345 678" }, error: null };
    h.rpc.mockResolvedValue({ data: 1, error: null });
    expect(await recordProspectOptOut(ID, "whatsapp", "stop_reply")).toEqual({ success: true, matched: 1 });
    expect(h.rpc).toHaveBeenCalledWith("admin_record_outbound_opt_out", {
      p_channel: "whatsapp",
      p_identifier: "0712 345 678",
      p_reason: "stop_reply",
      p_note: null,
    });
    expect(JSON.stringify(h.logAdminAction.mock.calls)).not.toContain("0712");
    expect(h.logAdminAction).toHaveBeenCalledWith(h.client, "record_outbound_opt_out", {
      prospect_id: ID,
      channel: "whatsapp",
      reason: "stop_reply",
      matched: 1,
    });
  });

  it("refuses when the prospect has no contact on that channel, or does not exist", async () => {
    h.results["outbound_prospects.maybeSingle"] = { data: { email: null, phone: "0712345678" }, error: null };
    expect(await recordProspectOptOut(ID, "email", "requested")).toEqual({ error: "No email address on file." });
    h.results["outbound_prospects.maybeSingle"] = { data: null, error: null };
    expect(await recordProspectOptOut(ID, "email", "requested")).toEqual({ error: "Outbound prospect not found." });
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("loadProspectContact", () => {
  it("checks opt-out only for channels the prospect actually has, and returns the history", async () => {
    h.results["outbound_prospects.maybeSingle"] = { data: { email: "head@school.invalid", phone: null }, error: null };
    h.results["outbound_contact_log.list"] = {
      data: [{ id: "l1", channel: "email", event: "sent", created_at: "2026-10-17T10:00:00Z", performed_by: null, note: null }],
      error: null,
    };
    h.rpc.mockResolvedValue({ data: true, error: null });
    const r = await loadProspectContact(ID);
    expect(r).toMatchObject({ success: true, blocked: { email: true, whatsapp: false } });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("admin_is_outbound_contact_blocked", {
      p_channel: "email",
      p_identifier: "head@school.invalid",
    });
    expect((r as { log: unknown[] }).log).toHaveLength(1);
  });

  it("fails closed: an error from the opt-out check is an error, not 'not blocked'", async () => {
    h.results["outbound_prospects.maybeSingle"] = { data: { email: "head@school.invalid", phone: null }, error: null };
    h.results["outbound_contact_log.list"] = { data: [], error: null };
    h.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await loadProspectContact(ID)).toEqual({ error: "boom" });
  });
});
