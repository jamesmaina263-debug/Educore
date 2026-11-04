import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateClient = vi.fn();
const mockDispatch = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: vi.fn() }));
vi.mock("@/lib/dispatch-communications-client", () => ({ dispatchQueuedCommunications: mockDispatch }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { saveBusAlertMode, sendTestBusAlert, sendDelayAlert, recordBusBoarding } = await import("./actions");

const UUID = "11111111-1111-4111-8111-111111111111";

type RpcReply = { data?: unknown; error?: { code?: string; message: string } | null };
function client(replies: Record<string, RpcReply>, user: unknown = { id: "u1" }) {
  const rpc = vi.fn(async (name: string) => replies[name] ?? { data: null, error: null });
  return { c: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) }, rpc }, rpc };
}
const live = (over: Record<string, unknown> = {}) => ({ mode: "live", guardians: 3, queued: 1, skipped_opt_out: 1, skipped_no_phone: 1, ...over });
beforeEach(() => {
  vi.clearAllMocks();
  mockDispatch.mockResolvedValue({ data: { total: 1, sent: 1, failed: 0 }, error: null });
});

describe("validation happens before any database call", () => {
  it("rejects bad mode, phone, route, delay, learner and kind", async () => {
    expect(await saveBusAlertMode({ mode: "party" as never, testPhone: null })).toEqual({ error: "Choose a mode." });
    expect(await saveBusAlertMode({ mode: "test", testPhone: "12" })).toMatchObject({ error: expect.stringMatching(/9 to 15 digits/) });
    expect(await sendDelayAlert({ routeId: "nope", minutes: 20, note: null })).toEqual({ error: "Choose a route." });
    expect(await sendDelayAlert({ routeId: UUID, minutes: 3, note: null })).toMatchObject({ error: expect.stringMatching(/5 to 180/) });
    expect(await recordBusBoarding({ studentId: "nope", kind: "boarded" })).toEqual({ error: "Choose a learner." });
    expect(await recordBusBoarding({ studentId: UUID, kind: "teleported" as never })).toEqual({ error: "Choose a learner." });
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });
  it("requires a signed-in user", async () => {
    mockCreateClient.mockResolvedValue(client({}, null).c);
    expect(await sendDelayAlert({ routeId: UUID, minutes: 20, note: null })).toEqual({ error: "You must be signed in." });
  });
});

describe("saveBusAlertMode", () => {
  it("passes the cleaned phone and mode to set_bus_alert_mode", async () => {
    const { c, rpc } = client({});
    mockCreateClient.mockResolvedValue(c);
    expect(await saveBusAlertMode({ mode: "test", testPhone: "0712 345-678" })).toMatchObject({ success: true });
    expect(rpc).toHaveBeenCalledWith("set_bus_alert_mode", { p_mode: "test", p_test_phone: "0712345678" });
  });
  it("shows the database's own test-first message and maps other refusals", async () => {
    mockCreateClient.mockResolvedValue(client({ set_bus_alert_mode: { error: { code: "22023", message: "Send a test alert to the test phone before switching to live." } } }).c);
    expect(await saveBusAlertMode({ mode: "live", testPhone: null })).toEqual({ error: "Send a test alert to the test phone before switching to live." });
    mockCreateClient.mockResolvedValue(client({ set_bus_alert_mode: { error: { code: "42501", message: "secret detail" } } }).c);
    const r = await saveBusAlertMode({ mode: "off", testPhone: null });
    expect(r).toEqual({ error: "You don't have permission to do that." });
  });
});

describe("sendTestBusAlert", () => {
  it("queues then dispatches once", async () => {
    const { c, rpc } = client({});
    mockCreateClient.mockResolvedValue(c);
    expect(await sendTestBusAlert()).toMatchObject({ success: true });
    expect(rpc).toHaveBeenCalledWith("send_bus_test_alert");
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });
  it("cancels the queued test if dispatch fails", async () => {
    const { c, rpc } = client({});
    mockCreateClient.mockResolvedValue(c);
    mockDispatch.mockResolvedValue({ data: null, error: { message: "down", context: { status: 502 } } });
    const r = await sendTestBusAlert();
    expect(r).toEqual({ error: expect.stringMatching(/cancelled instead of being sent late/) });
    expect(rpc).toHaveBeenCalledWith("cancel_unsent_bus_alerts");
  });
  it("tells staff to set the phone first when the database says so", async () => {
    mockCreateClient.mockResolvedValue(client({ send_bus_test_alert: { error: { code: "22023", message: "x" } } }).c);
    expect(await sendTestBusAlert()).toEqual({ error: "Set a staff test phone and switch to test mode first." });
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

describe("sendDelayAlert", () => {
  it("sends the right arguments, dispatches immediately and describes the result", async () => {
    const { c, rpc } = client({ send_bus_delay_alert: { data: live() } });
    mockCreateClient.mockResolvedValue(c);
    const r = await sendDelayAlert({ routeId: UUID, minutes: 20, note: "  Traffic  " });
    expect(rpc).toHaveBeenCalledWith("send_bus_delay_alert", { p_route_id: UUID, p_minutes: 20, p_note: "Traffic" });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ success: true, message: expect.stringMatching(/1 guardian was messaged; 1 opted out; 1 had no phone number/) });
  });
  it("does not dispatch when nothing was queued (off mode or everyone skipped)", async () => {
    mockCreateClient.mockResolvedValue(client({ send_bus_delay_alert: { data: live({ queued: 0 }) } }).c);
    const r = await sendDelayAlert({ routeId: UUID, minutes: 20, note: null });
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(r).toMatchObject({ success: true });
  });
  it("in test mode says it was a test and that no guardian was messaged", async () => {
    mockCreateClient.mockResolvedValue(client({ send_bus_delay_alert: { data: { mode: "test", guardians: 4, queued: 1 } } }).c);
    const r = await sendDelayAlert({ routeId: UUID, minutes: 20, note: null });
    expect(r).toMatchObject({ success: true, message: expect.stringMatching(/TEST MODE[\s\S]*No guardian was messaged[\s\S]*4 guardians/) });
  });
  it("cancels and reports an error if immediate dispatch fails, so nothing goes out late", async () => {
    const { c, rpc } = client({ send_bus_delay_alert: { data: live() } });
    mockCreateClient.mockResolvedValue(c);
    mockDispatch.mockRejectedValue(new Error("network"));
    const r = await sendDelayAlert({ routeId: UUID, minutes: 20, note: null });
    expect(r).toEqual({ error: expect.stringMatching(/cancelled instead of being sent late/) });
    expect(rpc).toHaveBeenCalledWith("cancel_unsent_bus_alerts");
  });
  it("maps database refusals without leaking details and never dispatches", async () => {
    mockCreateClient.mockResolvedValue(client({ send_bus_delay_alert: { error: { code: "P0001", message: "internal detail" } } }).c);
    const r = await sendDelayAlert({ routeId: UUID, minutes: 20, note: null });
    expect(r).toEqual({ error: expect.stringMatching(/10 minutes/) });
    expect(JSON.stringify(r)).not.toContain("internal detail");
    expect(mockDispatch).not.toHaveBeenCalled();
  });
  it("does not claim success when the result is unreadable", async () => {
    mockCreateClient.mockResolvedValue(client({ send_bus_delay_alert: { data: "garbage" } }).c);
    expect(await sendDelayAlert({ routeId: UUID, minutes: 20, note: null })).toMatchObject({ error: expect.stringMatching(/may not have been sent/) });
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

describe("recordBusBoarding", () => {
  it("records, dispatches and describes", async () => {
    const { c, rpc } = client({ record_bus_boarding: { data: live({ guardians: 1, skipped_opt_out: 0, skipped_no_phone: 0, event_id: UUID }) } });
    mockCreateClient.mockResolvedValue(c);
    const r = await recordBusBoarding({ studentId: UUID, kind: "boarded" });
    expect(rpc).toHaveBeenCalledWith("record_bus_boarding", { p_student_id: UUID, p_kind: "boarded", p_vehicle_id: null });
    expect(r).toMatchObject({ success: true, message: expect.stringMatching(/Boarding recorded/) });
  });
  it("keeps the event but warns, and cancels, when the message cannot be sent now", async () => {
    const { c, rpc } = client({ record_bus_boarding: { data: live() } });
    mockCreateClient.mockResolvedValue(c);
    mockDispatch.mockResolvedValue({ data: null, error: { message: "down", context: { status: 500 } } });
    const r = await recordBusBoarding({ studentId: UUID, kind: "dropped_off" });
    expect(r).toMatchObject({ success: true, warning: true, message: expect.stringMatching(/Drop-off was recorded, but .* cancelled instead of being sent late/) });
    expect(rpc).toHaveBeenCalledWith("cancel_unsent_bus_alerts");
  });
  it("maps a learner with no assignment", async () => {
    mockCreateClient.mockResolvedValue(client({ record_bus_boarding: { error: { code: "P0002", message: "x" } } }).c);
    expect(await recordBusBoarding({ studentId: UUID, kind: "boarded" })).toEqual({ error: expect.stringMatching(/no active bus assignment/) });
  });
});
