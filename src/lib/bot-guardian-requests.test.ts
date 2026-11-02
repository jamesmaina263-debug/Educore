/* eslint-disable @typescript-eslint/no-explicit-any -- loose fake Supabase client in tests */
import { describe, expect, it, vi } from "vitest";
import {
  classifyGuardianRequest,
  describeDate,
  nairobiToday,
  parseAbsenceDate,
  parseAbsenceReason,
  pickChildByName,
  tryHandleGuardianRequest as run,
} from "../../supabase/functions/_shared/chatbot/guardianRequests";

// 2026-11-02 is a Monday.
const TODAY = "2026-11-02";

describe("nairobiToday", () => {
  it("rolls to the next day after 21:00 UTC (Nairobi is UTC+3)", () => {
    expect(nairobiToday(new Date("2026-11-02T20:59:00Z"))).toBe("2026-11-02");
    expect(nairobiToday(new Date("2026-11-02T21:00:00Z"))).toBe("2026-11-03");
  });
});

describe("parseAbsenceDate", () => {
  it.each([
    ["Mary will be absent tomorrow", "2026-11-03"],
    ["Mary hatakuja kesho", "2026-11-03"],
    ["absent day after tomorrow", "2026-11-04"],
    ["absent kesho kutwa", "2026-11-04"],
    ["Mary is sick today", "2026-11-02"],
    ["Mary hayuko leo, mgonjwa", "2026-11-02"],
    ["he was absent yesterday", "2026-11-01"],
    ["absent on 2026-11-10", "2026-11-10"],
    ["absent on 5/11", "2026-11-05"],
    ["absent on 05-11-2026", "2026-11-05"],
    ["absent on 5 Nov", "2026-11-05"],
    ["absent on 5th of November", "2026-11-05"],
    ["absent on november 6", "2026-11-06"],
    ["hatakuja 7 Novemba", "2026-11-07"],
    ["absent on Wednesday", "2026-11-04"],
    ["absent on Jumanne", "2026-11-03"],
    ["absent next Monday", "2026-11-09"],
  ])("%s -> %s", (text, expected) => {
    expect(parseAbsenceDate(text, TODAY)).toBe(expected);
  });

  it("returns null when no day is given or the date is impossible", () => {
    expect(parseAbsenceDate("Mary will be absent", TODAY)).toBeNull();
    expect(parseAbsenceDate("absent on 31/02", TODAY)).toBeNull();
    expect(parseAbsenceDate("absent on 32 Nov", TODAY)).toBeNull();
  });

  it("treats an early-January date typed in late December as next January", () => {
    expect(parseAbsenceDate("absent on 5 Jan", "2026-12-28")).toBe("2027-01-05");
  });
});

describe("parseAbsenceReason", () => {
  it("reads because / due to / sababu clauses", () => {
    expect(parseAbsenceReason("Mary absent tomorrow because she has malaria.")).toBe("she has malaria");
    expect(parseAbsenceReason("absent due to a funeral")).toBe("a funeral");
    expect(parseAbsenceReason("hatakuja kesho kwa sababu ya ugonjwa")).toBe("ugonjwa");
  });
  it("reads text after a comma or dash", () => {
    expect(parseAbsenceReason("Mary absent tomorrow, fever")).toBe("fever");
    expect(parseAbsenceReason("Mary absent tomorrow - dentist")).toBe("dentist");
  });
  it("returns null with no reason and caps the length", () => {
    expect(parseAbsenceReason("Mary will be absent tomorrow")).toBeNull();
    expect(parseAbsenceReason("absent, " + "x".repeat(500))?.length).toBe(300);
  });
});

describe("classifyGuardianRequest", () => {
  it("recognises an absence note with date and reason", () => {
    expect(classifyGuardianRequest("Mary will be absent tomorrow, fever", TODAY)).toEqual({
      kind: "absence_report",
      date: "2026-11-03",
      reason: "fever",
    });
  });
  it("recognises an absence note with no date (the bot will ask)", () => {
    expect(classifyGuardianRequest("Mary is sick and will not be coming", TODAY)).toMatchObject({ kind: "absence_report", date: null });
  });
  it("recognises a request to change the number, with and without the number", () => {
    expect(classifyGuardianRequest("Please change my number to 0712 345 678", TODAY)).toEqual({
      kind: "contact_update",
      phone: "0712 345 678",
    });
    expect(classifyGuardianRequest("badilisha namba yangu mpya +254733111222", TODAY)).toMatchObject({ kind: "contact_update", phone: "+254733111222" });
    expect(classifyGuardianRequest("I want to update my phone number", TODAY)).toEqual({ kind: "contact_update", phone: null });
  });
  it("leaves questions and unrelated messages to the existing bot", () => {
    expect(classifyGuardianRequest("Was Mary absent yesterday?", TODAY)).toBeNull();
    expect(classifyGuardianRequest("Was Mary absent yesterday", TODAY)).toBeNull();
    expect(classifyGuardianRequest("what is my fee balance", TODAY)).toBeNull();
    expect(classifyGuardianRequest("hello", TODAY)).toBeNull();
    expect(classifyGuardianRequest("attendance", TODAY)).toBeNull();
    expect(classifyGuardianRequest("", TODAY)).toBeNull();
    expect(classifyGuardianRequest("what is my phone number now?", TODAY)).toBeNull();
  });
});

describe("pickChildByName / describeDate", () => {
  const kids = [{ first_name: "Mary" }, { first_name: "John" }];
  it("auto-picks an only child, needs a name otherwise", () => {
    expect(pickChildByName([kids[0]], "absent tomorrow")).toBe(kids[0]);
    expect(pickChildByName(kids, "absent tomorrow")).toBeNull();
    expect(pickChildByName(kids, "john absent tomorrow")).toBe(kids[1]);
    expect(pickChildByName(kids, "Mary and John absent")).toBeNull();
  });
  it("formats a date", () => {
    expect(describeDate("2026-11-04")).toBe("Wed 4 Nov 2026");
  });
});

// ---- Handler, with a fake Supabase client ----------------------------------------------------
const ACK = "ACK";
const G = "guardian-1";
const S = "school-1";

function fakeClient(opts: {
  enabled?: boolean | null;
  children?: { id: string; first_name: string; last_name: string; school_id: string }[];
  absence?: unknown;
  contact?: unknown;
  linked?: boolean;
}) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "bot_guardian_requests_enabled") return { data: opts.enabled ?? true, error: null };
    if (name === "bot_submit_absence_report") return { data: opts.absence ?? { ok: true, duplicate: false }, error: null };
    if (name === "bot_submit_contact_update") return { data: opts.contact ?? { ok: true }, error: null };
    return { data: null, error: { message: "unexpected" } };
  });
  const children = opts.children ?? [{ id: "st-1", first_name: "Mary", last_name: "W", school_id: S }];
  const from = vi.fn((table: string) => {
    if (table !== "student_guardians") throw new Error("unexpected table " + table);
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      // list of children (await chain) and single-link check (maybeSingle)
      maybeSingle: async () =>
        opts.linked === false ? { data: null, error: null } : { data: { student_id: children[0].id, students: { school_id: S } }, error: null },
      then: (res: (v: unknown) => unknown) =>
        res({ data: children.map((c) => ({ student_id: c.id, students: c })), error: null }),
    };
    return chain;
  });
  return { rpc, from };
}

function ctxOf(supabase: any, messageText: string) {
  return { supabase, schoolId: S, conversationId: "conv-1", guardianUserId: G, messageText };
}

// The same dependencies dispatcher.ts injects, backed by the fake client.
function tryHandleGuardianRequest(ctx: ReturnType<typeof ctxOf>, ack: string, now: Date) {
  const supabase = ctx.supabase;
  return run(
    ctx,
    {
      escalationAck: ack,
      wantsHuman: (t) => /\bagent\b/i.test(t),
      getChildren: async () => {
        const { data } = await supabase.from("student_guardians");
        return (data ?? []).map((r: any) => ({ student_id: r.student_id, first_name: r.students.first_name }));
      },
      canAccessStudent: async () => {
        const { data } = await supabase.from("student_guardians").select().eq().maybeSingle();
        return !!data;
      },
    },
    now,
  );
}

const NOW = new Date("2026-11-02T09:00:00Z");

describe("tryHandleGuardianRequest", () => {
  it("does nothing when the flag is off (existing bot unchanged) and writes nothing", async () => {
    const c = fakeClient({ enabled: false });
    const r = await tryHandleGuardianRequest(ctxOf(c, "Mary absent tomorrow"), ACK, NOW);
    expect(r).toBeNull();
    expect(c.rpc).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the flag lookup errors", async () => {
    const c = fakeClient({});
    c.rpc.mockRejectedValueOnce(new Error("boom"));
    expect(await tryHandleGuardianRequest(ctxOf(c, "Mary absent tomorrow"), ACK, NOW)).toBeNull();
  });

  it("ignores messages that are not requests, and explicit requests for a human", async () => {
    const c = fakeClient({});
    expect(await tryHandleGuardianRequest(ctxOf(c, "fee balance"), ACK, NOW)).toBeNull();
    expect(await tryHandleGuardianRequest(ctxOf(c, "agent, Mary is absent tomorrow"), ACK, NOW)).toBeNull();
  });

  it("files an absence note and says it does not change the register", async () => {
    const c = fakeClient({});
    const r = await tryHandleGuardianRequest(ctxOf(c, "Mary will be absent tomorrow, fever"), ACK, NOW);
    expect(r?.escalate).toBe(false);
    expect(r?.replyText).toContain("Tue 3 Nov 2026");
    expect(r?.replyText).toContain("does not change the attendance register");
    expect(c.rpc).toHaveBeenCalledWith(
      "bot_submit_absence_report",
      expect.objectContaining({ p_student_id: "st-1", p_absence_date: "2026-11-03", p_reason: "fever", p_guardian_user_id: G }),
    );
  });

  it("says so when the note already exists", async () => {
    const c = fakeClient({ absence: { ok: true, duplicate: true } });
    const r = await tryHandleGuardianRequest(ctxOf(c, "Mary absent tomorrow"), ACK, NOW);
    expect(r?.replyText).toContain("I already have a note");
  });

  it("asks for the day, and for the child when there are several, without writing", async () => {
    const one = fakeClient({});
    const r1 = await tryHandleGuardianRequest(ctxOf(one, "Mary is sick and will not be coming"), ACK, NOW);
    expect(r1?.replyText).toContain("Which day");
    expect(one.rpc).not.toHaveBeenCalledWith("bot_submit_absence_report", expect.anything());

    const two = fakeClient({
      children: [
        { id: "st-1", first_name: "Mary", last_name: "W", school_id: S },
        { id: "st-2", first_name: "John", last_name: "W", school_id: S },
      ],
    });
    const r2 = await tryHandleGuardianRequest(ctxOf(two, "absent tomorrow"), ACK, NOW);
    expect(r2?.replyText).toContain("more than one child");
    expect(two.rpc).not.toHaveBeenCalledWith("bot_submit_absence_report", expect.anything());
  });

  it("hands over to the office when the guardian is not linked to the child", async () => {
    const c = fakeClient({ linked: false });
    const r = await tryHandleGuardianRequest(ctxOf(c, "Mary absent tomorrow"), ACK, NOW);
    expect(r).toMatchObject({ escalate: true, escalationReason: "authorization_denied", replyText: ACK });
  });

  it("maps database refusals to plain replies", async () => {
    const bad = fakeClient({ absence: { ok: false, code: "bad_date" } });
    expect((await tryHandleGuardianRequest(ctxOf(bad, "Mary absent 5 Jan 2030"), ACK, NOW))?.replyText).toContain("30 days");
    const odd = fakeClient({ absence: { ok: false, code: "flag_off" } });
    expect(await tryHandleGuardianRequest(ctxOf(odd, "Mary absent tomorrow"), ACK, NOW)).toMatchObject({ escalate: true, escalationReason: "tool_error" });
  });

  it("queues a phone-number change and promises nothing changes until the office confirms", async () => {
    const c = fakeClient({});
    const r = await tryHandleGuardianRequest(ctxOf(c, "change my number to 0712345678"), ACK, NOW);
    expect(r?.replyText).toContain("0712345678");
    expect(r?.replyText).toContain("Nothing changes until the office confirms");
    expect(c.rpc).toHaveBeenCalledWith("bot_submit_contact_update", expect.objectContaining({ p_new_phone: "0712345678" }));
  });

  it("asks for the number when it is missing and explains refusals", async () => {
    const c = fakeClient({});
    const r = await tryHandleGuardianRequest(ctxOf(c, "I want to update my phone number"), ACK, NOW);
    expect(r?.replyText).toContain("change my number to");
    expect(c.rpc).not.toHaveBeenCalledWith("bot_submit_contact_update", expect.anything());

    const same = fakeClient({ contact: { ok: false, code: "same_number" } });
    expect((await tryHandleGuardianRequest(ctxOf(same, "change my number to 0712345678"), ACK, NOW))?.replyText).toContain("already the number");
    const bad = fakeClient({ contact: { ok: false, code: "bad_phone" } });
    expect((await tryHandleGuardianRequest(ctxOf(bad, "change my number to 0722345678"), ACK, NOW))?.replyText).toContain("Kenyan mobile");
  });
});
