import { describe, expect, it, vi } from "vitest";
import {
  classifyDirectorTopic,
  directorMenuText,
  formatDirectorReply,
  formatKes,
  tryHandleDirectorMessage,
  type RpcClient,
} from "../../supabase/functions/_shared/chatbot/director";
import { parseDirectorStatus, registerErrorMessage } from "./director-whatsapp";

describe("classifyDirectorTopic", () => {
  it.each([
    ["1", "collection_today"], ["2", "collection_week"], ["3", "outstanding"], ["4", "top_arrears"],
    ["5", "attendance_today"], ["6", "absentees_today"], ["7", "enrolment"],
    ["How much did we collect today?", "collection_today"],
    ["payments this week", "collection_week"],
    ["unpaid fees", "outstanding"],
    ["what is the outstanding balance", "outstanding"],
    ["top defaulters", "top_arrears"],
    ["who owes the most", "top_arrears"],
    ["attendance today", "attendance_today"],
    ["who is absent", "absentees_today"],
    ["how many students do we have", "enrolment"],
    ["mahudhurio", "attendance_today"],
  ])("%s -> %s", (text, topic) => expect(classifyDirectorTopic(text)).toBe(topic));

  it("shows the menu for anything unclear, never a guess", () => {
    for (const t of ["", "hi", "menu", "stop it", "what is the weather", "8", "0"]) expect(classifyDirectorTopic(t)).toBe("menu");
  });
});

describe("formatting", () => {
  it("formats shillings without decimals", () => {
    expect(formatKes(1234567.4)).toBe("KES 1,234,567");
    expect(formatKes("x")).toBe("KES 0");
  });
  it("formats collections with a method split", () => {
    const t = formatDirectorReply("collection_today", { total: 1800, count: 3, by_method: { mpesa: 1300, cash: 500 } }, "2026-11-04T09:30:00Z");
    expect(t).toContain("Collections today: KES 1,800 from 3 payments.");
    expect(t).toContain("M-Pesa KES 1,300, Cash KES 500");
    expect(t).toContain("12:30");
  });
  it("says so when nothing was collected", () => {
    expect(formatDirectorReply("collection_today", { total: 0, count: 0, by_method: {} }, null)).toContain("nothing recorded");
  });
  it("mentions money received but not allocated", () => {
    const t = formatDirectorReply("outstanding", { outstanding: 6500, learners_owing: 2, unallocated_received: 300 }, null);
    expect(t).toContain("KES 6,500 across 2 learners");
    expect(t).toContain("KES 300");
  });
  it("handles attendance not yet marked, absentee overflow and empty arrears", () => {
    expect(formatDirectorReply("attendance_today", { marked: 0, active_learners: 40 }, null)).toContain("No attendance has been marked yet today (40");
    expect(formatDirectorReply("absentees_today", { total: 17, names: ["A B.", "C D."] }, null)).toContain("and 15 more");
    expect(formatDirectorReply("top_arrears", { rows: [] }, null)).toContain("No active learner");
  });
  it("lists the menu", () => expect(directorMenuText()).toContain("7. Number of learners"));
});

function client(handlers: Record<string, (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }>): RpcClient {
  return { rpc: async (fn, args) => handlers[fn](args) } as RpcClient;
}

describe("tryHandleDirectorMessage", () => {
  const base = { phone: "+254712345678", messageSid: "SM1" };

  it("leaves everyone else alone (not found, error, or throw)", async () => {
    for (const lookup of [() => ({ data: [], error: null }), () => ({ data: null, error: { message: "x" } }), () => ({ data: [{}, {}], error: null })]) {
      expect(await tryHandleDirectorMessage({ ...base, text: "balance", supabase: client({ director_whatsapp_lookup: lookup }) })).toEqual({ handled: false });
    }
    const thrower = { rpc: async () => { throw new Error("network"); } } as unknown as RpcClient;
    expect(await tryHandleDirectorMessage({ ...base, text: "balance", supabase: thrower })).toEqual({ handled: false });
  });

  it("answers a known topic from the database function", async () => {
    const answer = vi.fn(() => ({ data: { status: "ok", topic: "enrolment", as_of: "2026-11-04T09:30:00Z", data: { active_learners: 312 } }, error: null }));
    const res = await tryHandleDirectorMessage({
      ...base,
      text: "how many students",
      supabase: client({ director_whatsapp_lookup: () => ({ data: [{ school_id: "s" }], error: null }), director_whatsapp_answer: answer }),
    });
    expect(res.handled).toBe(true);
    expect(res.reply).toContain("Active learners: 312.");
    expect(answer).toHaveBeenCalledWith({ p_phone: "+254712345678", p_topic: "enrolment", p_message_sid: "SM1" });
  });

  it("shows the menu without touching the answer function when the text is unclear", async () => {
    const answer = vi.fn();
    const res = await tryHandleDirectorMessage({
      ...base, text: "hello",
      supabase: client({ director_whatsapp_lookup: () => ({ data: [{}], error: null }), director_whatsapp_answer: answer as never }),
    });
    expect(res.reply).toContain("1. Collections today");
    expect(answer).not.toHaveBeenCalled();
  });

  it("stays silent on a duplicate delivery, gives a calm message on error, and falls through if eligibility ended", async () => {
    const mk = (answer: () => { data: unknown; error: { message: string } | null }) =>
      client({ director_whatsapp_lookup: () => ({ data: [{}], error: null }), director_whatsapp_answer: answer });
    expect(await tryHandleDirectorMessage({ ...base, text: "balance", supabase: mk(() => ({ data: { status: "duplicate" }, error: null })) })).toEqual({ handled: true });
    const err = await tryHandleDirectorMessage({ ...base, text: "balance", supabase: mk(() => ({ data: null, error: { message: "boom" } })) });
    expect(err.reply).toContain("try again");
    expect(err.reply).not.toContain("boom");
    expect(await tryHandleDirectorMessage({ ...base, text: "balance", supabase: mk(() => ({ data: { status: "not_director" }, error: null })) })).toEqual({ handled: false });
  });
});

describe("registration helpers", () => {
  it("parses status defensively", () => {
    expect(parseDirectorStatus(null)).toEqual({ eligible: false, registered: false, phoneMasked: null, optedInAt: null });
    expect(parseDirectorStatus({ eligible: true, registered: true, phone_masked: "+254******678", opted_in_at: "2026-11-04T00:00:00Z" }).phoneMasked).toBe("+254******678");
  });
  it("turns database statuses into sentences", () => {
    expect(registerErrorMessage({ status: "registered" })).toBeNull();
    expect(registerErrorMessage({ status: "phone_mismatch" })).toContain("staff profile");
    expect(registerErrorMessage({ status: "weird" })).toContain("Could not register");
    expect(registerErrorMessage(null)).toContain("Could not register");
  });
});
