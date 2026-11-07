import { describe, expect, it } from "vitest";
import { formatGroupDigest, summariseGroupDigests, summariseSameDayAbsence } from "./group-digest-messages";

const fees = { outstanding: 100000, learners_owing: 12 };
const figures = { kind: "saturday", week_from: "2026-10-31", week_to: "2026-11-06", collected: 900000, previous_week: 600000, attendance_rate_pct: 94.5, fees };
const payload = { kind: "group_saturday", schools: [{ school: "North Campus", figures }, { school: "South Campus", figures }] };

describe("formatGroupDigest", () => {
  it("one block per school, in order", () => {
    const t = formatGroupDigest(payload)!;
    expect(t).toContain("Weekly group summary");
    expect(t.indexOf("North Campus")).toBeLessThan(t.indexOf("South Campus"));
    expect(t.split("Outstanding fees:").length - 1).toBe(2);
  });
  it("fails closed on anything malformed", () => {
    expect(formatGroupDigest(null)).toBeNull();
    expect(formatGroupDigest({ kind: "group_saturday", schools: [] })).toBeNull();
    expect(formatGroupDigest({ kind: "saturday", schools: payload.schools })).toBeNull();
    expect(formatGroupDigest({ kind: "group_saturday", schools: [{ school: "", figures }] })).toBeNull();
    expect(formatGroupDigest({ kind: "group_saturday", schools: [{ school: "X", figures: { kind: "saturday" } }] })).toBeNull();
    expect(formatGroupDigest({ kind: "group_saturday", schools: [payload.schools[0], { school: "Bad", figures: null }] })).toBeNull();
  });
});

describe("summaries are counts only", () => {
  it("group digests", () => {
    const rows = [
      { log_id: "a", school_group_id: "g1", school_user_id: "u1", phone: "+254700000666", payload },
      { log_id: "b", school_group_id: "g2", school_user_id: "u2", phone: "+254700000667", payload: { kind: "group_saturday", schools: [{ school: "Z", figures: {} }] } },
    ];
    const s = summariseGroupDigests(rows);
    expect(s).toEqual({ total: 2, groups: 2, schools_covered: 3, formattable: 1, unformattable: 1 });
    expect(JSON.stringify(s)).not.toContain("+254");
    expect(summariseGroupDigests(null).total).toBe(0);
  });
  it("same-day absence", () => {
    const rows = [
      { log_id: "a", school_id: "s1", student_id: "l1", guardian_user_id: "g1", phone: "+254700000444" },
      { log_id: "b", school_id: "s1", student_id: "l2", guardian_user_id: "g1", phone: "+254700000444" },
      { log_id: "c", school_id: "s2", student_id: "l3", guardian_user_id: "g2", phone: "0700" },
    ];
    expect(summariseSameDayAbsence(rows)).toEqual({ total: 3, schools: 2, learners: 3, guardians: 2, valid_phone: 2 });
    expect(summariseSameDayAbsence(undefined).total).toBe(0);
  });
});
