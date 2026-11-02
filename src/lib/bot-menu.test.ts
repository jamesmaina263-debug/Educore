/* eslint-disable @typescript-eslint/no-explicit-any -- loose fake Supabase client in tests */
import { describe, expect, it, vi } from "vitest";
import {
  attendanceText,
  chatText,
  feeBalanceText,
  languageCommand,
  looksSwahili,
  menuChoice,
  menuItems,
  menuText,
  noAttendanceText,
  prepareMenuTurn,
  wantsMenu,
} from "../../supabase/functions/_shared/chatbot/menu";
import { classifyGuardianRequest, describeDate, tryHandleGuardianRequest } from "../../supabase/functions/_shared/chatbot/guardianRequests";

const ALL = { documents: true, guardianRequests: true };
const BASE = { documents: false, guardianRequests: false };

describe("menu items and numbering", () => {
  it("lists only what the school has switched on, agent always last", () => {
    expect(menuItems(BASE)).toEqual(["fee_balance", "attendance", "agent"]);
    expect(menuItems({ documents: true, guardianRequests: false })).toEqual(["fee_balance", "attendance", "report_card", "statement", "agent"]);
    expect(menuItems(ALL)).toEqual(["fee_balance", "attendance", "report_card", "statement", "report_absence", "change_number", "agent"]);
  });
  it("numbers the menu in both languages", () => {
    const en = menuText("en", ALL);
    expect(en).toContain("1. Fee balance");
    expect(en).toContain("7. Talk to the school office");
    expect(en).toContain("'Kiswahili'");
    const sw = menuText("sw", BASE);
    expect(sw).toContain("1. Salio la ada");
    expect(sw).toContain("3. Ongea na ofisi ya shule");
    expect(sw).toContain("'English'");
  });
  it("maps a digit to the words the existing intents understand", () => {
    expect(menuChoice("1", ALL)).toEqual({ kind: "rewrite", text: "fee balance" });
    expect(menuChoice(" 2 ", ALL)).toEqual({ kind: "rewrite", text: "attendance" });
    expect(menuChoice("3", ALL)).toEqual({ kind: "rewrite", text: "report card" });
    expect(menuChoice("4", ALL)).toEqual({ kind: "rewrite", text: "fee statement" });
    expect(menuChoice("5", ALL)).toEqual({ kind: "guide", key: "guideAbsence" });
    expect(menuChoice("6", ALL)).toEqual({ kind: "guide", key: "guideNumber" });
    expect(menuChoice("7", ALL)).toEqual({ kind: "rewrite", text: "agent" });
    // numbering follows the school's features
    expect(menuChoice("3", BASE)).toEqual({ kind: "rewrite", text: "agent" });
  });
  it("ignores everything that is not a single digit 1-9 in range", () => {
    for (const t of ["0", "8", "12", "fee", "1234", "", "1."]) expect(menuChoice(t, BASE)).toBeNull();
  });
});

describe("language words", () => {
  it("recognises Kiswahili messages and leaves English and ambiguous words alone", () => {
    for (const t of ["Habari", "naomba salio la ada", "Mahudhurio ya mtoto", "tafadhali nisaidie", "Mary hatakuja kesho"]) expect(looksSwahili(t)).toBe(true);
    for (const t of ["hello", "fee balance", "Leo will be absent", "sasa", "how much"]) expect(looksSwahili(t)).toBe(false);
  });
  it("reads language and menu commands", () => {
    expect(languageCommand("Kiswahili")).toBe("sw");
    expect(languageCommand("swahili.")).toBe("sw");
    expect(languageCommand("English")).toBe("en");
    expect(languageCommand("kiingereza")).toBe("en");
    expect(languageCommand("english please")).toBeNull();
    expect(wantsMenu("Menu")).toBe(true);
    expect(wantsMenu("orodha")).toBe(true);
    expect(wantsMenu("0")).toBe(true);
    expect(wantsMenu("menu for lunch")).toBe(false);
  });
});

describe("reply text", () => {
  it("English replies are exactly what the bot said before the menu existed", () => {
    expect(feeBalanceText("en", { name: "Mary", balance: 12500 })).toBe("Mary's outstanding fee balance is KES 12,500.");
    expect(feeBalanceText("en", { name: "Mary", balance: 0 })).toBe("Mary's fee account is fully paid up. No outstanding balance.");
    expect(feeBalanceText("en", { name: "Mary", balance: -300 })).toBe("Mary's fee account is fully paid up (a credit of KES 300). No outstanding balance.");
    expect(attendanceText("en", { name: "Mary", status: "late", date: "2026-11-02", absences: 2 })).toBe(
      "Mary was marked late on 2026-11-02. 2 absence(s) recorded in the last 30 days.",
    );
    expect(attendanceText("en", { name: "Mary", status: "weird", date: "2026-11-02", absences: 0 })).toContain("marked absent");
    expect(noAttendanceText("en", "Mary")).toBe("I don't have any attendance records for Mary yet.");
    expect(chatText("en", "ack")).toBe("I've passed your message to the school office -- someone will get back to you here on WhatsApp shortly.");
    expect(chatText("en", "disambiguate", { names: "Mary, John" })).toBe(
      "You have more than one child with us (Mary, John). Please reply with the child's first name so I know who you mean.",
    );
    expect(chatText("en", "switched", { name: "Mary" })).toBe("Switched -- I'll answer about Mary from here. Ask me about fee balance or attendance.");
  });
  it("Kiswahili replies carry the same numbers and names", () => {
    expect(feeBalanceText("sw", { name: "Mary", balance: 12500 })).toBe("Salio la ada la Mary ni KES 12,500.");
    expect(feeBalanceText("sw", { name: "Mary", balance: 0 })).toContain("imelipwa kikamilifu");
    expect(feeBalanceText("sw", { name: "Mary", balance: -300 })).toContain("ziada ya KES 300");
    const a = attendanceText("sw", { name: "Mary", status: "absent", date: "2026-11-02", absences: 3 });
    expect(a).toContain("hakuwepo");
    expect(a).toContain("2026-11-02");
    expect(a).toContain(": 3.");
    expect(noAttendanceText("sw", "Mary")).toContain("Mary");
    expect(chatText("sw", "disambiguate", { names: "Mary, John" })).toContain("(Mary, John)");
  });
  it("the guidance examples are understood by the request classifier", () => {
    const TODAY = "2026-11-02";
    expect(classifyGuardianRequest(chatText("en", "guideAbsence").split(": ")[1], TODAY)).toMatchObject({ kind: "absence_report", date: "2026-11-03" });
    expect(classifyGuardianRequest(chatText("sw", "guideAbsence").split(": ")[1], TODAY)).toMatchObject({ kind: "absence_report", date: "2026-11-03", reason: "homa" });
    expect(classifyGuardianRequest("change my number to 0712345678", TODAY)).toMatchObject({ kind: "contact_update" });
    expect(classifyGuardianRequest("badilisha namba yangu mpya 0712345678", TODAY)).toMatchObject({ kind: "contact_update", phone: "0712345678" });
  });
  it("describeDate in Kiswahili", () => {
    expect(describeDate("2026-11-04")).toBe("Wed 4 Nov 2026");
    expect(describeDate("2026-11-04", "sw")).toBe("Jumatano 4 Nov 2026");
  });
});

function fakeRpc(opts: { menu?: boolean; requests?: boolean; lang?: string } = {}) {
  const calls: any[] = [];
  let lang = opts.lang ?? "en";
  const rpc = vi.fn(async (name: string, args: any) => {
    calls.push([name, args]);
    if (name === "bot_menu_enabled") return { data: opts.menu ?? true, error: null };
    if (name === "bot_guardian_requests_enabled") return { data: opts.requests ?? true, error: null };
    if (name === "bot_get_language") return { data: lang, error: null };
    if (name === "bot_set_language") { lang = args.p_language; return { data: { ok: true }, error: null }; }
    return { data: null, error: { message: "unexpected" } };
  });
  return { rpc, calls };
}
const kids = [
  { student_id: "s1", first_name: "Mary" },
  { student_id: "s2", first_name: "John" },
];
function turn(sb: any, messageText: string, getChildren = async () => kids) {
  return prepareMenuTurn({ supabase: sb, schoolId: "sch", conversationId: "conv", messageText, documents: true, getChildren });
}

describe("prepareMenuTurn", () => {
  it("returns null and changes nothing when the flag is off", async () => {
    const sb = fakeRpc({ menu: false });
    expect(await turn(sb, "Habari")).toBeNull();
    expect(sb.rpc).toHaveBeenCalledTimes(1);
  });
  it("fails closed when the flag lookup throws or errors", async () => {
    const sb = fakeRpc();
    sb.rpc.mockRejectedValueOnce(new Error("down"));
    expect(await turn(sb, "menu")).toBeNull();
  });
  it("shows the menu for 'menu' in the stored language", async () => {
    const t = await turn(fakeRpc({ lang: "sw" }), "menu");
    expect(t?.language).toBe("sw");
    expect(t?.reply?.text).toContain("1. Salio la ada");
  });
  it("saves the language when the guardian asks for it and confirms in that language", async () => {
    const sb = fakeRpc();
    const t = await turn(sb, "Kiswahili");
    expect(sb.calls).toContainEqual(["bot_set_language", { p_school_id: "sch", p_conversation_id: "conv", p_language: "sw" }]);
    expect(t?.reply?.text).toContain("Sawa, nitajibu kwa Kiswahili");
    expect(t?.reply?.text).toContain("1. Salio la ada");
    const back = await turn(fakeRpc({ lang: "sw" }), "English");
    expect(back?.reply?.text).toContain("Okay, I'll reply in English");
  });
  it("switches to Kiswahili on a clearly Kiswahili message and carries on with the original text", async () => {
    const sb = fakeRpc();
    const t = await turn(sb, "naomba salio la ada");
    expect(t?.language).toBe("sw");
    expect(t?.text).toBe("naomba salio la ada");
    expect(t?.reply).toBeUndefined();
    expect(sb.calls.some((c) => c[0] === "bot_set_language")).toBe(true);
  });
  it("does not flip back to English on an English message (only 'English' does)", async () => {
    const sb = fakeRpc({ lang: "sw" });
    const t = await turn(sb, "fee balance");
    expect(t?.language).toBe("sw");
    expect(sb.calls.some((c) => c[0] === "bot_set_language")).toBe(false);
  });
  it("rewrites a menu number and shows guidance for the request items", async () => {
    expect((await turn(fakeRpc(), "1"))?.text).toBe("fee balance");
    expect((await turn(fakeRpc(), "5"))?.reply?.text).toContain("will be absent tomorrow");
    expect((await turn(fakeRpc({ lang: "sw" }), "6"))?.reply?.text).toContain("badilisha namba yangu mpya");
  });
  it("numbering follows the school's enabled features", async () => {
    const t = await turn(fakeRpc({ requests: false }), "5");
    expect(t?.text).toBe("agent"); // documents on, requests off: 1-4 as before, 5 is the office
    expect(t?.features.guardianRequests).toBe(false);
    expect((await turn(fakeRpc({ requests: false }), "6"))?.text).toBe("6"); // no item 6: left for the normal path
  });
  it("a bare child's name switches the child and shows the menu", async () => {
    const t = await turn(fakeRpc(), "mary");
    expect(t?.reply?.studentId).toBe("s1");
    expect(t?.reply?.text).toContain("Switched -- I'll answer about Mary");
    const none = await turn(fakeRpc(), "Peter");
    expect(none?.reply).toBeUndefined();
  });
  it("does not look up children for messages that are not a single word", async () => {
    const getChildren = vi.fn(async () => kids);
    await turn(fakeRpc(), "fee balance", getChildren);
    expect(getChildren).not.toHaveBeenCalled();
  });
});

describe("guardian request replies in Kiswahili", () => {
  it("answers an absence note in Kiswahili when the conversation language is sw", async () => {
    const supabase = {
      rpc: vi.fn(async (name: string) => {
        if (name === "bot_guardian_requests_enabled") return { data: true, error: null };
        if (name === "bot_submit_absence_report") return { data: { ok: true, duplicate: false }, error: null };
        return { data: null, error: { message: "x" } };
      }),
    };
    const r = await tryHandleGuardianRequest(
      { supabase, schoolId: "s", conversationId: "c", guardianUserId: "g", messageText: "Mary hatakuja kesho, homa", language: "sw" },
      {
        escalationAck: "ACK",
        wantsHuman: () => false,
        getChildren: async () => [{ student_id: "st", first_name: "Mary" }],
        canAccessStudent: async () => true,
      },
      new Date("2026-11-02T09:00:00Z"),
    );
    expect(r?.replyText).toContain("Asante. Nimeandika kuwa Mary hatakuja tarehe Jumanne 3 Nov 2026.");
    expect(r?.replyText).toContain("haubadilishi rejista ya mahudhurio");
  });
});
