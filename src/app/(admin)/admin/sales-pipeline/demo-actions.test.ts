import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const rpc = vi.fn();
  const client = { rpc };
  return { rpc, client, logAdminAction: vi.fn(), revalidatePath: vi.fn() };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: async () => {} }));
vi.mock("@/lib/log-admin-action", () => ({ logAdminAction: h.logAdminAction }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));

const { bookSalesLeadDemo, rescheduleSalesLeadDemo, closeSalesLeadDemo } = await import("./demo-actions");

const LEAD = "11111111-1111-4111-8111-111111111111";
const DEMO = "33333333-3333-4333-8333-333333333333";
const REP = "22222222-2222-4222-8222-222222222222";
const FUTURE = "2099-01-05T10:00"; // far future so the test never ages out

beforeEach(() => {
  h.rpc.mockReset();
  h.logAdminAction.mockReset();
  h.revalidatePath.mockReset();
});

describe("bookSalesLeadDemo", () => {
  it("rejects bad input before touching the database", async () => {
    const good = { scheduledLocal: FUTURE, mode: "phone" };
    expect(await bookSalesLeadDemo("nope", good, null, null)).toEqual({ error: "Invalid lead id." });
    expect(await bookSalesLeadDemo(LEAD, good, "nope", null)).toEqual({ error: "Invalid team member." });
    expect(await bookSalesLeadDemo(LEAD, good, null, "nope")).toEqual({ error: "Invalid rep." });
    expect(await bookSalesLeadDemo(LEAD, { ...good, scheduledLocal: "2020-01-01T10:00" }, null, null)).toEqual({
      error: "Pick a date and time in the future.",
    });
    expect(await bookSalesLeadDemo(LEAD, { ...good, mode: "zoom" }, null, null)).toMatchObject({ error: expect.any(String) });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("sends the instant as UTC, audits ids and mode only (never the location text)", async () => {
    h.rpc.mockResolvedValue({ data: "demo-id", error: null });
    const r = await bookSalesLeadDemo(LEAD, { scheduledLocal: FUTURE, mode: "in_person", locationNote: " Room 4, Secret Wing " }, REP, REP);
    expect(r).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_book_sales_lead_demo", {
      p_lead_id: LEAD,
      p_scheduled_for: "2099-01-05T07:00:00.000Z",
      p_mode: "in_person",
      p_location_note: "Room 4, Secret Wing",
      p_host_id: REP,
      p_performed_by: REP,
    });
    expect(h.logAdminAction).toHaveBeenCalledWith(h.client, "book_sales_lead_demo", { lead_id: LEAD, mode: "in_person" });
    expect(JSON.stringify(h.logAdminAction.mock.calls)).not.toContain("Secret");
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/sales-pipeline");
  });

  it("returns the database message and logs nothing when the RPC refuses", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "This lead already has a scheduled demo. Reschedule or cancel it first." } });
    expect(await bookSalesLeadDemo(LEAD, { scheduledLocal: FUTURE, mode: "phone" }, null, null)).toEqual({
      error: "This lead already has a scheduled demo. Reschedule or cancel it first.",
    });
    expect(h.logAdminAction).not.toHaveBeenCalled();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("rescheduleSalesLeadDemo", () => {
  it("validates, then calls the RPC with a UTC instant", async () => {
    expect(await rescheduleSalesLeadDemo("nope", FUTURE, null)).toEqual({ error: "Invalid demo id." });
    expect(await rescheduleSalesLeadDemo(DEMO, "2020-01-01T10:00", null)).toEqual({ error: "Pick a date and time in the future." });
    expect(h.rpc).not.toHaveBeenCalled();
    h.rpc.mockResolvedValue({ data: null, error: null });
    expect(await rescheduleSalesLeadDemo(DEMO, FUTURE, REP)).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_reschedule_sales_lead_demo", {
      p_demo_id: DEMO,
      p_scheduled_for: "2099-01-05T07:00:00.000Z",
      p_performed_by: REP,
    });
    expect(h.logAdminAction).toHaveBeenCalledWith(h.client, "reschedule_sales_lead_demo", { demo_id: DEMO });
  });
});

describe("closeSalesLeadDemo", () => {
  it("accepts only held / no_show / cancelled", async () => {
    expect(await closeSalesLeadDemo(DEMO, "scheduled", null, null)).toEqual({ error: "Unknown status." });
    expect(await closeSalesLeadDemo("nope", "held", null, null)).toEqual({ error: "Invalid demo id." });
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("passes the trimmed note to the RPC but audits only ids and the status", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    expect(await closeSalesLeadDemo(DEMO, "held", "  liked the fees page  ", REP)).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_set_sales_lead_demo_status", {
      p_demo_id: DEMO,
      p_status: "held",
      p_outcome_note: "liked the fees page",
      p_performed_by: REP,
    });
    expect(h.logAdminAction).toHaveBeenCalledWith(h.client, "set_sales_lead_demo_status", { demo_id: DEMO, status: "held" });
    expect(JSON.stringify(h.logAdminAction.mock.calls)).not.toContain("fees page");
  });
});
