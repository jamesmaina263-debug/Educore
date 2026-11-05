import { describe, expect, it, vi } from "vitest";
import { answerBusQuestion, busReplyText, mentionsBus, parseBotBusStatus, type BusRpcClient } from "../../supabase/functions/_shared/chatbot/bus";
import { classifyIntent } from "../../supabase/functions/_shared/chatbot/intents";

describe("mentionsBus", () => {
  it.each(["where is the bus", "Where is my child's school bus?", "BUS", "basi liko wapi", "is the school van late", "buses today"])("yes: %s", (t) =>
    expect(mentionsBus(t)).toBe(true));
  it.each(["business hours", "I am busy", "bust", "fee balance", "", "abuse"])("no: %s", (t) => expect(mentionsBus(t)).toBe(false));
});

describe("classifyIntent with the bus option", () => {
  it("is off by default: a bus message classifies as before (unknown, so it goes to the office)", () => {
    expect(classifyIntent("where is the bus")).toBe("unknown");
    expect(classifyIntent("where is the bus", { documents: true })).toBe("unknown");
    expect(classifyIntent("where is the bus", { bus: false })).toBe("unknown");
  });
  it("answers a bus question only when on", () => {
    expect(classifyIntent("where is the bus", { bus: true })).toBe("bus");
    expect(classifyIntent("basi liko wapi", { bus: true })).toBe("bus");
  });
  it("keeps fees, attendance and escalation ahead of the bus", () => {
    expect(classifyIntent("bus fee balance", { bus: true })).toBe("fee_balance");
    expect(classifyIntent("did he take the bus, attendance", { bus: true })).toBe("attendance");
    expect(classifyIntent("talk to someone about the bus", { bus: true })).toBe("escalate");
  });
  it("does not change any existing classification", () => {
    for (const t of ["hi", "fee balance", "attendance", "switch to Mary", "report card", "fee statement", "what time is it", ""]) {
      expect(classifyIntent(t, { documents: true, bus: true })).toBe(classifyIntent(t, { documents: true }));
    }
  });
});

describe("parseBotBusStatus fails closed", () => {
  it("reads the four answers", () => {
    expect(parseBotBusStatus({ status: "live", route: "North", stop: "Gate", age_seconds: 125 })).toEqual({ status: "live", route: "North", stop: "Gate", ageSeconds: 125 });
    expect(parseBotBusStatus({ status: "not_live", route: "North", stop: null })).toEqual({ status: "not_live", route: "North", stop: null });
    expect(parseBotBusStatus({ status: "no_vehicle", route: "South" })).toEqual({ status: "no_vehicle", route: "South" });
    expect(parseBotBusStatus({ status: "no_assignment" })).toEqual({ status: "no_assignment" });
  });
  it("returns null for forbidden, disabled, unknown, malformed", () => {
    for (const v of [{ status: "forbidden" }, { status: "disabled" }, { status: "weird" }, { status: "live" }, { status: "live", age_seconds: -3 }, { status: "live", age_seconds: "x" }, null, undefined, "live", [], 5]) {
      expect(parseBotBusStatus(v)).toBeNull();
    }
  });
});

describe("busReplyText", () => {
  const live = { status: "live", route: "North Route", stop: "Gate Stop", ageSeconds: 130 } as const;
  it("English live reply has route, stop and age, no position", () => {
    const t = busReplyText("en", "Ann", live);
    expect(t).toContain("Ann's bus");
    expect(t).toContain("North Route");
    expect(t).toContain("Gate Stop");
    expect(t).toContain("2 min ago");
    expect(t).not.toMatch(/-?\d+\.\d{3,}/);
    expect(t).not.toMatch(/openstreetmap|maps\.google/i);
  });
  it("says just now under a minute", () => expect(busReplyText("en", "Ann", { ...live, ageSeconds: 20 })).toContain("just now"));
  it("covers every status in both languages", () => {
    for (const lang of ["en", "sw"] as const) {
      for (const s of [live, { status: "not_live", route: null, stop: null }, { status: "no_vehicle", route: "South" }, { status: "no_assignment" }] as const) {
        const t = busReplyText(lang, "Ann", s);
        expect(t.length).toBeGreaterThan(20);
        expect(t).toContain("Ann");
      }
    }
  });
  it("does not claim a position for a bus that is not live", () => {
    expect(busReplyText("en", "Ann", { status: "not_live", route: "North", stop: null })).toContain("not sharing");
  });
});

function client(rpc: (name: string, args: Record<string, unknown>) => unknown) {
  return { rpc: vi.fn(async (name: string, args?: Record<string, unknown>) => rpc(name, args ?? {})) } as never as BusRpcClient & { rpc: ReturnType<typeof vi.fn> };
}
const ids = { schoolId: "s1", guardianUserId: "g1", studentId: "st1" };

describe("answerBusQuestion", () => {
  it("passes school, guardian and learner to the database and formats the answer", async () => {
    const c = client(() => ({ data: { status: "live", route: "North", stop: "Gate", age_seconds: 70 }, error: null }));
    const out = await answerBusQuestion(c, ids, "en", "Ann");
    expect(out).toContain("Ann's bus");
    expect(c.rpc.mock.calls[0]).toEqual(["bot_guardian_bus_status", { p_school_id: "s1", p_guardian_user_id: "g1", p_student_id: "st1" }]);
  });
  it("replies in Kiswahili when the conversation is", async () => {
    const c = client(() => ({ data: { status: "no_assignment" }, error: null }));
    expect(await answerBusQuestion(c, ids, "sw", "Ann")).toContain("hajapangiwa");
  });
  it("throws (so the dispatcher escalates) on a database error, forbidden, disabled or garbage", async () => {
    await expect(answerBusQuestion(client(() => ({ data: null, error: { message: "boom" } })), ids, "en", "Ann")).rejects.toThrow();
    for (const status of ["forbidden", "disabled", "nonsense"]) {
      await expect(answerBusQuestion(client(() => ({ data: { status }, error: null })), ids, "en", "Ann")).rejects.toThrow();
    }
  });
});
