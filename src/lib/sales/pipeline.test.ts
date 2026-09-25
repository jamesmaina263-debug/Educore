import { describe, it, expect } from "vitest";
import {
  STAGES,
  csvSafe,
  formatDateOnly,
  formatInstantNairobi,
  funnelCounts,
  isFollowUpOverdue,
  isFollowUpToday,
  isValidDateString,
  isValidStage,
  leadsToCsvRows,
  mondayOf,
  todayInNairobi,
  validateLeadInput,
  weekStartInstant,
  weeklyActivityByRep,
  type SalesLeadRow,
} from "./pipeline";

const REP_A = "11111111-1111-4111-8111-111111111111";
const REP_B = "22222222-2222-4222-8222-222222222222";

function lead(overrides: Partial<SalesLeadRow> = {}): SalesLeadRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    created_at: "2026-09-20T08:00:00Z",
    updated_at: "2026-09-20T08:00:00Z",
    school_name: "Alpha Academy",
    town_county: null,
    school_type: null,
    contact_name: null,
    contact_role: null,
    phone: null,
    email: null,
    current_system: null,
    pain_points: null,
    source: null,
    student_count: null,
    stage: "new",
    stage_changed_at: "2026-09-20T08:00:00Z",
    lost_reason: null,
    assigned_to: null,
    next_follow_up_on: null,
    notes: null,
    ...overrides,
  };
}

describe("todayInNairobi", () => {
  it("rolls to the next calendar day at 21:00 UTC (midnight EAT)", () => {
    expect(todayInNairobi(new Date("2026-09-23T20:59:00Z"))).toBe("2026-09-23");
    expect(todayInNairobi(new Date("2026-09-23T21:00:00Z"))).toBe("2026-09-24");
  });
});

describe("week helpers", () => {
  it("finds the Monday for any weekday, including Sunday", () => {
    expect(mondayOf("2026-09-24")).toBe("2026-09-21"); // Thursday
    expect(mondayOf("2026-09-21")).toBe("2026-09-21"); // Monday
    expect(mondayOf("2026-09-27")).toBe("2026-09-21"); // Sunday belongs to the week that started Monday
  });

  it("week starts at Monday 00:00 Nairobi = Sunday 21:00 UTC", () => {
    expect(weekStartInstant("2026-09-24")).toBe("2026-09-20T21:00:00.000Z");
  });
});

describe("follow-up rules", () => {
  it("is overdue only when strictly before today and the lead is still open", () => {
    expect(isFollowUpOverdue("2026-09-23", "visited", "2026-09-24")).toBe(true);
    expect(isFollowUpOverdue("2026-09-24", "visited", "2026-09-24")).toBe(false);
    expect(isFollowUpOverdue(null, "visited", "2026-09-24")).toBe(false);
    expect(isFollowUpOverdue("2026-09-01", "paid", "2026-09-24")).toBe(false);
    expect(isFollowUpOverdue("2026-09-01", "lost", "2026-09-24")).toBe(false);
  });

  it("flags due-today only for open leads", () => {
    expect(isFollowUpToday("2026-09-24", "demo_booked", "2026-09-24")).toBe(true);
    expect(isFollowUpToday("2026-09-24", "lost", "2026-09-24")).toBe(false);
    expect(isFollowUpToday("2026-09-25", "demo_booked", "2026-09-24")).toBe(false);
  });
});

describe("funnelCounts", () => {
  it("counts every stage, including zeros, and ignores unknown stages", () => {
    const counts = funnelCounts([
      { stage: "new" },
      { stage: "new" },
      { stage: "pilot" },
      { stage: "not-a-stage" },
    ]);
    expect(counts.new).toBe(2);
    expect(counts.pilot).toBe(1);
    expect(counts.paid).toBe(0);
    expect(Object.keys(counts)).toHaveLength(STAGES.length);
  });
});

describe("weeklyActivityByRep", () => {
  const since = "2026-09-20T21:00:00.000Z";
  it("counts visits and total effort per rep, skips stage changes and old rows", () => {
    const rows = weeklyActivityByRep(
      [
        { created_at: "2026-09-21T09:00:00Z", activity_type: "visit", performed_by: REP_A },
        { created_at: "2026-09-22T09:00:00Z", activity_type: "visit", performed_by: REP_A },
        { created_at: "2026-09-22T10:00:00Z", activity_type: "call", performed_by: REP_A },
        { created_at: "2026-09-22T11:00:00Z", activity_type: "visit", performed_by: REP_B },
        { created_at: "2026-09-22T12:00:00Z", activity_type: "stage_change", performed_by: REP_B },
        { created_at: "2026-09-19T12:00:00Z", activity_type: "visit", performed_by: REP_B }, // before the week
        { created_at: "2026-09-23T12:00:00Z", activity_type: "note", performed_by: null },
      ],
      since,
    );
    const a = rows.find((r) => r.repId === REP_A);
    const b = rows.find((r) => r.repId === REP_B);
    const none = rows.find((r) => r.repId === null);
    expect(a).toEqual({ repId: REP_A, visits: 2, totalActivities: 3 });
    expect(b).toEqual({ repId: REP_B, visits: 1, totalActivities: 1 });
    expect(none).toEqual({ repId: null, visits: 0, totalActivities: 1 });
    expect(rows[0].repId).toBe(REP_A); // sorted by effort, highest first
  });
});

describe("validateLeadInput", () => {
  it("requires a school name", () => {
    const res = validateLeadInput({ school_name: "   " });
    expect(res.ok).toBe(false);
  });

  it("trims, turns blanks into null, and accepts a minimal lead", () => {
    const res = validateLeadInput({ school_name: "  Beta School ", phone: "  ", town_county: " Nakuru " });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.school_name).toBe("Beta School");
      expect(res.value.phone).toBeNull();
      expect(res.value.town_county).toBe("Nakuru");
      expect(res.value.id).toBeNull();
    }
  });

  it("rejects out-of-list enums, bad numbers, bad ids and impossible dates", () => {
    expect(validateLeadInput({ school_name: "X", school_type: "weird" }).ok).toBe(false);
    expect(validateLeadInput({ school_name: "X", source: "carrier-pigeon" }).ok).toBe(false);
    expect(validateLeadInput({ school_name: "X", student_count: -1 }).ok).toBe(false);
    expect(validateLeadInput({ school_name: "X", student_count: 1.5 }).ok).toBe(false);
    expect(validateLeadInput({ school_name: "X", assigned_to: "not-a-uuid" }).ok).toBe(false);
    expect(validateLeadInput({ school_name: "X", id: "nope" }).ok).toBe(false);
    expect(validateLeadInput({ school_name: "X", next_follow_up_on: "2026-02-30" }).ok).toBe(false);
    expect(validateLeadInput({ school_name: "X", next_follow_up_on: "24/09/2026" }).ok).toBe(false);
  });

  it("rejects over-long fields", () => {
    expect(validateLeadInput({ school_name: "x".repeat(201) }).ok).toBe(false);
    expect(validateLeadInput({ school_name: "X", notes: "n".repeat(4001) }).ok).toBe(false);
  });

  it("accepts a fully populated lead", () => {
    const res = validateLeadInput({
      id: "33333333-3333-4333-8333-333333333333",
      school_name: "Gamma",
      school_type: "private",
      source: "door_visit",
      student_count: 420,
      assigned_to: REP_A,
      next_follow_up_on: "2026-10-01",
    });
    expect(res.ok).toBe(true);
  });
});

describe("date + stage guards", () => {
  it("isValidDateString rejects rolled-over dates", () => {
    expect(isValidDateString("2026-09-24")).toBe(true);
    expect(isValidDateString("2026-02-29")).toBe(false);
    expect(isValidDateString("2026-9-4")).toBe(false);
  });

  it("isValidStage matches the known list only", () => {
    expect(isValidStage("demo_done")).toBe(true);
    expect(isValidStage("closed")).toBe(false);
  });
});

describe("CSV export", () => {
  it("neutralises spreadsheet formula injection", () => {
    expect(csvSafe("=HYPERLINK(\"http://evil\")")).toBe("'=HYPERLINK(\"http://evil\")");
    expect(csvSafe("+254700000000")).toBe("'+254700000000");
    expect(csvSafe("-1")).toBe("'-1");
    expect(csvSafe("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvSafe("Normal school")).toBe("Normal school");
    expect(csvSafe("")).toBe("");
  });

  it("builds rows with readable stage/source/rep names and safe text", () => {
    const rows = leadsToCsvRows(
      [
        lead({
          school_name: "=cmd|' /C calc'!A0",
          stage: "decision_maker_met",
          source: "door_visit",
          assigned_to: REP_A,
          student_count: 300,
          next_follow_up_on: "2026-10-02",
        }),
        lead({ school_name: "Plain", stage: "lost", lost_reason: "Signed with competitor" }),
      ],
      new Map([[REP_A, "Rep A"]]),
    );
    expect(rows[0].School).toBe("'=cmd|' /C calc'!A0");
    expect(rows[0].Stage).toBe("Decision-maker met");
    expect(rows[0].Source).toBe("Door visit");
    expect(rows[0].Rep).toBe("Rep A");
    expect(rows[0].Students).toBe(300);
    expect(rows[1].Rep).toBe("");
    expect(rows[1]["Lost reason"]).toBe("Signed with competitor");
    expect(rows[1].Source).toBe("");
  });
});

describe("display formatting", () => {
  it("formats instants in Nairobi time regardless of the server zone", () => {
    // 22:30 UTC on the 23rd is already the 24th in Nairobi.
    expect(formatInstantNairobi("2026-09-23T22:30:00Z")).toMatch(/^24 Sep\w* 2026$/);
    expect(formatInstantNairobi("2026-09-23T22:30:00Z", true)).toContain("01:30");
  });

  it("formats date-only values without shifting the day", () => {
    expect(formatDateOnly("2026-09-24")).toMatch(/^24 Sep\w* 2026$/);
  });
});
