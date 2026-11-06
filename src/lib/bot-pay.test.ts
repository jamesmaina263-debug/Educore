import { describe, expect, it, vi } from "vitest";
import {
  classifyPayMessage,
  parseConfirmResult,
  parsePrepareResult,
  tryHandleBotPay,
  type PayCtx,
  type PayDeps,
} from "../../supabase/functions/_shared/chatbot/pay";

describe("classifyPayMessage", () => {
  it.each([
    ["pay", { kind: "pay", amount: null }],
    ["Pay fees", { kind: "pay", amount: null }],
    ["PAY 3000", { kind: "pay", amount: 3000 }],
    ["pay kes 5,000", { kind: "pay", amount: 5000 }],
    ["lipa 2000", { kind: "pay", amount: 2000 }],
    ["pay all", { kind: "pay", amount: "all" }],
    ["lipa yote", { kind: "pay", amount: "all" }],
    ["pay 2000 for Mary", { kind: "pay", amount: 2000 }],
    ["pay 100.5", { kind: "pay", amount: 100.5 }],
    ["YES", { kind: "yes" }],
    ["Ndio.", { kind: "yes" }],
    ["no", { kind: "no" }],
    ["hapana", { kind: "no" }],
  ])("%s", (text, expected) => expect(classifyPayMessage(text)).toEqual(expected));

  it.each([
    "", "how do I pay fees", "can I pay by mpesa?", "payment", "paying", "I want to pay 2000", "what is my balance", "payroll",
    "pay 1000 and 2000", "pay 500 all", "fee balance", "yes please", "no thanks", "report card", "1", "bus",
  ])("not ours: %s", (text) => expect(classifyPayMessage(text)).toBeNull());
});

describe("parse results fail closed", () => {
  it("prepare", () => {
    expect(parsePrepareResult({ status: "awaiting_confirm", amount: 3000, balance: 5000, phone_last3: "333" })).toEqual({ status: "awaiting_confirm", amount: 3000, balance: 5000, phoneLast3: "333" });
    expect(parsePrepareResult({ status: "awaiting_confirm", amount: 3000, balance: 5000, phone_last3: "3333" })).toBeNull();
    expect(parsePrepareResult({ status: "ask_amount", balance: 0 })).toBeNull();
    expect(parsePrepareResult({ status: "mystery" })).toBeNull();
    expect(parsePrepareResult(null)).toBeNull();
    expect(parsePrepareResult({ status: "too_high", balance: "4000" })).toEqual({ status: "too_high", balance: 4000 });
  });
  it("confirm", () => {
    expect(parseConfirmResult({ status: "started", request_id: "r1", amount: 3000 })).toEqual({ status: "started", requestId: "r1", amount: 3000 });
    expect(parseConfirmResult({ status: "started", amount: 3000 })).toBeNull();
    expect(parseConfirmResult({ status: "nope" })).toBeNull();
  });
});

type Rpc = Record<string, unknown>;
function harness(rpcs: Rpc, over: Partial<PayDeps> = {}, ctxOver: Partial<PayCtx> = {}, text = "pay 3000") {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const supabase = {
    rpc: vi.fn((name: string, args: Record<string, unknown> = {}) => {
      calls.push([name, args]);
      const v = rpcs[name];
      if (v instanceof Error) return Promise.resolve({ data: null, error: { message: v.message } });
      return Promise.resolve({ data: typeof v === "function" ? (v as (a: Record<string, unknown>) => unknown)(args) : v, error: null });
    }),
  };
  const deps: PayDeps = {
    getChildren: async () => [{ student_id: "s1", first_name: "Amani" }],
    resolveChild: (children) => ({ student: children[0] ?? null, needsDisambiguation: false }),
    canAccessStudent: async () => true,
    dispatchPush: vi.fn(async () => true),
    escalationAck: "ACK",
    ...over,
  };
  const ctx: PayCtx = { supabase, schoolId: "sch", conversationId: "conv", guardianUserId: "g1", currentStudentId: null, messageText: text, ...ctxOver };
  return { ctx, deps, calls, run: () => tryHandleBotPay(ctx, deps) };
}

describe("tryHandleBotPay", () => {
  it("ignores unrelated messages without touching the database", async () => {
    const h = harness({}, {}, {}, "what is my fee balance");
    expect(await h.run()).toBeNull();
    expect(h.calls).toHaveLength(0);
  });

  it("does nothing when the school has it off (one flag lookup only)", async () => {
    const h = harness({ bot_pay_enabled: false });
    expect(await h.run()).toBeNull();
    expect(h.calls.map((c) => c[0])).toEqual(["bot_pay_enabled"]);
  });

  it("'pay' with no amount shows the balance and how to pay", async () => {
    const h = harness({ bot_pay_enabled: true, bot_guardian_pay_prepare: { status: "ask_amount", balance: 5000 } }, {}, {}, "pay");
    const r = await h.run();
    expect(r?.replyText).toContain("KES 5,000");
    expect(r?.replyText).toContain("PAY ALL");
    expect(r?.escalate).toBe(false);
    expect(h.calls[1][1].p_amount).toBeNull();
  });

  it("asks the guardian to confirm, naming only the last 3 digits of the number", async () => {
    const h = harness({ bot_pay_enabled: true, bot_guardian_pay_prepare: { status: "awaiting_confirm", amount: 3000, balance: 5000, phone_last3: "333" } });
    const r = await h.run();
    expect(r?.replyText).toMatch(/Pay KES 3,000 for Amani/);
    expect(r?.replyText).toMatch(/ending 333/);
    expect(r?.replyText).toMatch(/YES/);
    expect(h.calls[1]).toEqual(["bot_guardian_pay_prepare", { p_school_id: "sch", p_conversation_id: "conv", p_guardian_user_id: "g1", p_student_id: "s1", p_amount: 3000 }]);
    expect(h.deps.dispatchPush).not.toHaveBeenCalled();
  });

  it("'pay all' asks for the balance, then prepares exactly that amount", async () => {
    const prepare = vi.fn((a: Record<string, unknown>) =>
      a.p_amount === null ? { status: "ask_amount", balance: 4200 } : { status: "awaiting_confirm", amount: a.p_amount, balance: 4200, phone_last3: "333" });
    const h = harness({ bot_pay_enabled: true, bot_guardian_pay_prepare: prepare }, {}, {}, "pay all");
    const r = await h.run();
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(r?.replyText).toContain("KES 4,200");
  });

  it.each([
    [{ status: "too_low" }, /minimum is KES 10/],
    [{ status: "not_whole" }, /whole shillings/],
    [{ status: "too_high", balance: 5000 }, /more than the outstanding balance of KES 5,000/],
    [{ status: "no_balance" }, /no outstanding fee balance/],
    [{ status: "rate_limited" }, /Too many attempts/],
  ])("explains %j", async (prepared, re) => {
    const h = harness({ bot_pay_enabled: true, bot_guardian_pay_prepare: prepared });
    const r = await h.run();
    expect(r?.replyText).toMatch(re);
    expect(r?.escalate).toBe(false);
  });

  it("escalates (never guesses) when the database says forbidden or the number is not configured", async () => {
    expect((await harness({ bot_pay_enabled: true, bot_guardian_pay_prepare: { status: "forbidden" } }).run())?.escalationReason).toBe("authorization_denied");
    expect((await harness({ bot_pay_enabled: true, bot_guardian_pay_prepare: { status: "not_configured" } }).run())?.escalationReason).toBe("tool_error");
  });

  it("throws on a database error or an unrecognised answer so the dispatcher escalates", async () => {
    await expect(harness({ bot_pay_enabled: true, bot_guardian_pay_prepare: new Error("boom") }).run()).rejects.toThrow(/failed/);
    await expect(harness({ bot_pay_enabled: true, bot_guardian_pay_prepare: { status: "surprise" } }).run()).rejects.toThrow(/does not act on/);
    await expect(harness({ bot_pay_enabled: new Error("down") }).run()).rejects.toThrow(/bot_pay_enabled failed/);
  });

  it("with two children and no signal it asks which child, and prepares nothing", async () => {
    const h = harness({ bot_pay_enabled: true }, {
      getChildren: async () => [{ student_id: "s1", first_name: "Amani" }, { student_id: "s2", first_name: "Baraka" }],
      resolveChild: () => ({ student: null, needsDisambiguation: true }),
    });
    const r = await h.run();
    expect(r?.replyText).toContain("Amani, Baraka");
    expect(h.calls.map((c) => c[0])).toEqual(["bot_pay_enabled"]);
  });

  it("escalates when the guardian is not linked to the child", async () => {
    const h = harness({ bot_pay_enabled: true }, { canAccessStudent: async () => false });
    expect((await h.run())?.escalationReason).toBe("authorization_denied");
    expect(h.calls.map((c) => c[0])).toEqual(["bot_pay_enabled"]);
  });

  it("YES sends the prompt through the internal push and never mentions a number or asks for a PIN", async () => {
    const h = harness({ bot_guardian_pay_confirm: { status: "started", request_id: "req-9", amount: 3000 } }, {}, {}, "YES");
    const r = await h.run();
    expect(h.deps.dispatchPush).toHaveBeenCalledWith("req-9");
    expect(r?.replyText).toMatch(/Enter your M-Pesa PIN on your phone/);
    expect(r?.replyText).toMatch(/Never share your PIN/);
    expect(r?.replyText).not.toMatch(/\d{9}/);
  });

  it("YES when the push cannot be sent says nothing was charged", async () => {
    const h = harness({ bot_guardian_pay_confirm: { status: "started", request_id: "r", amount: 100 } }, { dispatchPush: async () => false }, {}, "yes");
    expect((await h.run())?.replyText).toMatch(/Nothing has been charged/);
    const h2 = harness({ bot_guardian_pay_confirm: { status: "started", request_id: "r", amount: 100 } }, { dispatchPush: async () => { throw new Error("net"); } }, {}, "yes");
    expect((await h2.run())?.replyText).toMatch(/Nothing has been charged/);
  });

  it("YES with nothing awaiting (or feature off) is not ours: falls through to the normal bot", async () => {
    expect(await harness({ bot_guardian_pay_confirm: { status: "none" } }, {}, {}, "yes").run()).toBeNull();
    expect(await harness({ bot_guardian_pay_confirm: { status: "disabled" } }, {}, {}, "yes").run()).toBeNull();
  });

  it.each([
    [{ status: "expired" }, /expired/],
    [{ status: "in_progress" }, /just sent to your phone/],
    [{ status: "too_high", balance: 3000 }, /more than the outstanding balance of KES 3,000/],
    [{ status: "rate_limited" }, /Too many attempts/],
  ])("YES -> %j", async (confirmed, re) => {
    const h = harness({ bot_guardian_pay_confirm: confirmed }, {}, {}, "yes");
    expect((await h.run())?.replyText).toMatch(re);
    expect(h.deps.dispatchPush).not.toHaveBeenCalled();
  });

  it("NO cancels what is awaiting, and is otherwise ignored", async () => {
    expect((await harness({ bot_guardian_pay_cancel: true }, {}, {}, "no").run())?.replyText).toMatch(/cancelled/);
    expect(await harness({ bot_guardian_pay_cancel: false }, {}, {}, "no").run()).toBeNull();
  });

  it("replies in Kiswahili when the conversation language is sw", async () => {
    const h = harness({ bot_pay_enabled: true, bot_guardian_pay_prepare: { status: "awaiting_confirm", amount: 3000, balance: 5000, phone_last3: "333" } }, {}, { language: "sw" });
    expect((await h.run())?.replyText).toMatch(/Lipa KES 3,000/);
    const h2 = harness({ bot_guardian_pay_confirm: { status: "started", request_id: "r", amount: 3000 } }, {}, { language: "sw" }, "ndio");
    expect((await h2.run())?.replyText).toMatch(/Usimpe mtu yeyote PIN/);
  });
});
