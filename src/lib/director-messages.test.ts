import { describe, expect, it } from "vitest";
import { formatAlert, formatBriefing, formatKes, shortDate, summariseDirectorBriefings } from "./director-messages";

const fees = { outstanding: 1250000.5, learners_owing: 42 };
const morning = {
  kind: "morning", school_day: "2026-11-04", collected_from: "2026-11-04", collected_to: "2026-11-04", collected: 85500, payments: 6,
  attendance: { active_learners: 300, marked: 290, present: 270, late: 10, absent: 10 }, fees,
};
const saturday = { kind: "saturday", week_from: "2026-10-31", week_to: "2026-11-06", collected: 900000, previous_week: 600000, attendance_rate_pct: 94.5, fees };

describe("formatKes / shortDate", () => {
  it("formats", () => {
    expect(formatKes(1250000.5)).toBe("KES 1,250,001");
    expect(formatKes("85500")).toBe("KES 85,500");
    expect(formatKes(null)).toBe("KES 0");
    expect(formatKes("abc")).toBe("KES 0");
  });
  it("dates", () => {
    expect(shortDate("2026-11-04")).toBe("Wed 4 Nov");
    expect(shortDate("2026-02-30")).toBeNull();
    expect(shortDate("04/11/2026")).toBeNull();
  });
});

describe("formatBriefing", () => {
  it("morning: collections, attendance, fees, and the unallocated note", () => {
    const t = formatBriefing(morning)!;
    expect(t).toContain("Collections (Wed 4 Nov): KES 85,500 from 6 payments.");
    expect(t).toContain("Attendance (Wed 4 Nov): 280 of 290 marked in school (270 present, 10 late, 10 absent), 300 active learners.");
    expect(t).toContain("Outstanding fees: KES 1,250,001 across 42 learners.");
    expect(t).toContain("unallocated");
  });
  it("morning after a weekend uses a date range, and says nothing recorded / not marked honestly", () => {
    const t = formatBriefing({ ...morning, school_day: "2026-11-02", collected_from: "2026-11-02", collected_to: "2026-11-08", collected: 0, payments: 0, attendance: { ...morning.attendance, marked: 0, present: 0, late: 0, absent: 0 } })!;
    expect(t).toContain("Collections (Mon 2 Nov to Sun 8 Nov): nothing recorded.");
    expect(t).toContain("Attendance (Mon 2 Nov): not marked.");
  });
  it("singular wording", () => {
    const t = formatBriefing({ ...morning, payments: 1, fees: { outstanding: 100, learners_owing: 1 } })!;
    expect(t).toContain("from 1 payment.");
    expect(t).toContain("across 1 learner.");
  });
  it("saturday: week total, trend and attendance rate", () => {
    const t = formatBriefing(saturday)!;
    expect(t).toContain("Collections Sat 31 Oct to Fri 6 Nov: KES 900,000 (up 50% on the week before, KES 600,000).");
    expect(t).toContain("Attendance Mon to Fri: 94.5% in school.");
  });
  it("saturday edge cases: no previous week, no attendance, down, same", () => {
    expect(formatBriefing({ ...saturday, previous_week: 0 })).toContain("(nothing recorded the week before)");
    expect(formatBriefing({ ...saturday, previous_week: 0, collected: 0 })).not.toContain("the week before");
    expect(formatBriefing({ ...saturday, attendance_rate_pct: null })).toContain("not marked");
    expect(formatBriefing({ ...saturday, collected: 300000 })).toContain("down 50%");
    expect(formatBriefing({ ...saturday, collected: 600000 })).toContain("same as the week before");
  });
  it("fails closed on anything malformed", () => {
    for (const bad of [null, undefined, "x", [], {}, { kind: "sunday" }, { ...morning, fees: null }, { ...morning, fees: { outstanding: "x", learners_owing: 1 } },
      { ...morning, school_day: "nope" }, { ...morning, attendance: null }, { ...morning, collected: "n/a" }, { ...saturday, week_from: 5 },
      { ...saturday, attendance_rate_pct: "high" }, { ...saturday, previous_week: undefined }]) {
      expect(formatBriefing(bad)).toBeNull();
    }
  });
  it("never includes a phone, id or other personal data", () => {
    const t = formatBriefing({ ...morning, phone: "+254700000000", school_user_id: "abc" })!;
    expect(t).not.toMatch(/\+254|abc/);
  });
});

describe("formatAlert", () => {
  it("formats the three alert types", () => {
    expect(formatAlert("large_payment", { amount: 250000, method: "mpesa" })).toBe("School alert: a large payment of KES 250,000 was just recorded by M-Pesa.");
    expect(formatAlert("large_payment", { amount: 250000, method: "weird" })).toBe("School alert: a large payment of KES 250,000 was just recorded.");
    expect(formatAlert("collection_drop", { current: 40000, previous: 100000, drop_pct: 60 })).toContain("60% lower");
    expect(formatAlert("low_attendance", { rate_pct: 71.4, marked: 214, active_learners: 300 })).toBe("School alert: attendance today is 71% (214 of 300 active learners marked so far).");
  });
  it("fails closed", () => {
    for (const [t, p] of [["large_payment", { amount: 0 }], ["large_payment", {}], ["collection_drop", { current: 1, previous: 0, drop_pct: 5 }], ["low_attendance", { rate_pct: 70, marked: 0, active_learners: 10 }], ["other", { amount: 5 }], [null, {}], ["large_payment", null]] as const) {
      expect(formatAlert(t, p)).toBeNull();
    }
  });
});

describe("summariseDirectorBriefings", () => {
  it("counts only, and flags rows that cannot be formatted", () => {
    const rows = [
      { log_id: "1", school_id: "s1", school_user_id: "u1", phone: "+254700000001", kind: "morning", payload: morning },
      { log_id: "2", school_id: "s1", school_user_id: "u2", phone: "+254700000002", kind: "saturday", payload: saturday },
      { log_id: "3", school_id: "s2", school_user_id: "u3", phone: "+254700000003", kind: "morning", payload: { broken: true } },
    ];
    const s = summariseDirectorBriefings(rows);
    expect(s).toEqual({ total: 3, schools: 2, directors: 3, by_kind: { morning: 2, saturday: 1 }, formattable: 2, unformattable: 1 });
    expect(JSON.stringify(s)).not.toMatch(/254|KES/);
  });
  it("handles empty input", () => {
    expect(summariseDirectorBriefings(null).total).toBe(0);
    expect(summariseDirectorBriefings(undefined).formattable).toBe(0);
  });
});
