import { describe, expect, it, vi } from "vitest";
import { classifyLeaveMessage, tryHandleLeaveApproval } from "../../supabase/functions/_shared/chatbot/leaveApproval";

describe("classifyLeaveMessage", () => {
  it.each([
    ["leave", { kind: "list" }],
    ["Pending leave", { kind: "list" }],
    ["leave requests", { kind: "list" }],
    ["APPROVE a7f2", { kind: "decision", decision: "approved", ref: "A7F2" }],
    ["reject 09AB.", { kind: "decision", decision: "rejected", ref: "09AB" }],
    ["482913", { kind: "code", code: "482913" }],
    [" 000000 ", { kind: "code", code: "000000" }],
  ])("%s", (text, expected) => expect(classifyLeaveMessage(text)).toEqual(expected));

  it.each(["", "approve", "approve A7F2 please", "approve ZZZZ", "approve all", "reject", "12345", "1234567", "leave school early", "I want leave", "yes", "balance", "pay 5000", "approve 12345"])(
    "not ours: %s",
    (text) => expect(classifyLeaveMessage(text)).toBeNull(),
  );
});

type Reply = { data?: unknown; error?: { message: string } | null };
function harness(rpcs: Record<string, Reply | (() => never)>, text: string) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const supabase = {
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      const r = rpcs[fn];
      if (typeof r === "function") r();
      return Promise.resolve({ data: (r as Reply | undefined)?.data ?? null, error: (r as Reply | undefined)?.error ?? null });
    }),
  };
  return { calls, run: () => tryHandleLeaveApproval({ supabase, phone: "+254700000611", text, messageSid: "SM1" }) };
}

describe("tryHandleLeaveApproval", () => {
  it("ignores unrelated messages without touching the database", async () => {
    const h = harness({}, "what is my fee balance");
    expect(await h.run()).toEqual({ handled: false, replies: [] });
    expect(h.calls).toHaveLength(0);
  });

  it("a sender who is not a verified approver falls through (handled=false)", async () => {
    for (const text of ["leave", "approve A7F2", "482913"]) {
      const h = harness({ leave_wa_pending: { data: { status: "not_approver" } }, leave_wa_request_code: { data: { status: "not_approver" } }, leave_wa_decide: { data: { status: "not_approver" } } }, text);
      expect(await h.run()).toEqual({ handled: false, replies: [] });
    }
  });

  it("lists pending leave with refs and says what to do next", async () => {
    const h = harness({
      leave_wa_pending: { data: { status: "ok", in_app_only: 2, items: [{ ref: "A7F2", name: "Mary W", type: "Annual", days: 3, start: "2026-11-12", end: "2026-11-14" }, { ref: "09AB", name: "Joe K", type: "Sick", days: 1, start: "2026-11-13", end: "2026-11-13" }] } },
    }, "leave");
    const r = await h.run();
    expect(r.handled).toBe(true);
    expect(r.replies).toHaveLength(1);
    expect(r.replies[0]).toContain("A7F2: Mary W, Annual, 3 days (12 Nov to 14 Nov)");
    expect(r.replies[0]).toContain("09AB: Joe K, Sick, 1 day (13 Nov)");
    expect(r.replies[0]).toContain("APPROVE A7F2");
    expect(r.replies[0]).toContain("2 longer requests must be decided in the app");
  });

  it("says so when nothing is pending", async () => {
    const r = await harness({ leave_wa_pending: { data: { status: "ok", in_app_only: 0, items: [] } } }, "leave").run();
    expect(r.replies[0]).toMatch(/no pending leave/);
  });

  it("APPROVE sends an explanation and the code as a separate message; never records anything", async () => {
    const h = harness({ leave_wa_request_code: { data: { status: "code_issued", code: "482913", decision: "approved", name: "Mary W", days: 3 } } }, "approve a7f2");
    const r = await h.run();
    expect(h.calls).toEqual([["leave_wa_request_code", { p_phone: "+254700000611", p_ref: "A7F2", p_decision: "approved" }]]);
    expect(r.replies).toHaveLength(2);
    expect(r.replies[0]).toMatch(/approve Mary W's 3 days of leave/);
    expect(r.replies[0]).not.toContain("482913");
    expect(r.replies[1]).toBe("Your code: 482913");
  });

  it("refuses a malformed code from the database rather than sending it", async () => {
    const r = await harness({ leave_wa_request_code: { data: { status: "code_issued", code: "12ab56", name: "M", days: 1 } } }, "approve a7f2").run();
    expect(r).toEqual({ handled: false, replies: [] });
  });

  it.each([
    ["not_found", /couldn't find that request/],
    ["ambiguous", /more than one request/],
    ["own_request", /can't decide your own leave/],
    ["too_long", /longer than 5 days/],
    ["rate_limited", /Too many attempts/],
  ])("request-code status %s", async (status, re) => {
    const r = await harness({ leave_wa_request_code: { data: { status } } }, "reject A7F2").run();
    expect(r.handled).toBe(true);
    expect(r.replies[0]).toMatch(re);
  });

  it("the 6-digit code records the decision, passing the MessageSid for retry safety", async () => {
    const h = harness({ leave_wa_decide: { data: { status: "recorded", decision: "approved" } } }, "482913");
    const r = await h.run();
    expect(h.calls).toEqual([["leave_wa_decide", { p_phone: "+254700000611", p_code: "482913", p_message_sid: "SM1" }]]);
    expect(r.replies[0]).toBe("Done. The leave was approved and the staff member has been notified.");
    const r2 = await harness({ leave_wa_decide: { data: { status: "recorded", decision: "rejected" } } }, "482913").run();
    expect(r2.replies[0]).toMatch(/rejected/);
  });

  it("a Twilio retry (duplicate) says nothing more", async () => {
    expect(await harness({ leave_wa_decide: { data: { status: "duplicate" } } }, "482913").run()).toEqual({ handled: true, replies: [] });
  });

  it.each([
    [{ status: "no_code" }, /no code waiting/],
    [{ status: "wrong_code", attempts_left: 1 }, /not right\. 1 attempt left/],
    [{ status: "wrong_code", attempts_left: 2 }, /2 attempts left/],
    [{ status: "locked" }, /cancelled/],
    [{ status: "expired" }, /expired/],
    [{ status: "no_longer_pending" }, /nothing was changed/],
    [{ status: "own_request" }, /own leave/],
    [{ status: "too_long" }, /longer than 5 days/],
  ])("decide status %j", async (data, re) => {
    const r = await harness({ leave_wa_decide: { data } }, "482913").run();
    expect(r.handled).toBe(true);
    expect(r.replies[0]).toMatch(re);
  });

  it("any error or unknown answer falls through and never records anything", async () => {
    for (const [fn, text] of [["leave_wa_pending", "leave"], ["leave_wa_request_code", "approve A7F2"], ["leave_wa_decide", "482913"]] as const) {
      expect(await harness({ [fn]: { error: { message: "boom" } } }, text).run()).toEqual({ handled: false, replies: [] });
      expect(await harness({ [fn]: { data: { status: "surprise" } } }, text).run()).toEqual({ handled: false, replies: [] });
      expect(await harness({ [fn]: () => { throw new Error("net"); } }, text).run()).toEqual({ handled: false, replies: [] });
    }
  });

  it("strips formatting characters from names before sending", async () => {
    const r = await harness({ leave_wa_request_code: { data: { status: "code_issued", code: "123456", name: "Ann *bold*\nnew", days: 1 } } }, "approve 0a0a").run();
    expect(r.replies[0]).toContain("Ann bold new's 1 day");
  });
});
