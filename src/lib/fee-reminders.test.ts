import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCHEDULE,
  chunkSlips,
  describeSchedule,
  describeSendOutcome,
  reminderTone,
  templateProblem,
  validateSchedule,
  type ReminderSchedule,
} from "./fee-reminders";

const ok: ReminderSchedule = { ...DEFAULT_SCHEDULE, enabled: true, minBalance: 500 };

describe("validateSchedule", () => {
  it("accepts a valid schedule", () => {
    expect(validateSchedule(ok)).toEqual({ value: ok });
  });
  it("rejects unknown frequency or channel", () => {
    expect(validateSchedule({ ...ok, frequency: "daily" as never })).toHaveProperty("error");
    expect(validateSchedule({ ...ok, channel: "email" as never })).toHaveProperty("error");
  });
  it("bounds weekday, day of month, minimum balance and gap", () => {
    expect(validateSchedule({ ...ok, runWeekday: 7 })).toHaveProperty("error");
    expect(validateSchedule({ ...ok, runWeekday: -1 })).toHaveProperty("error");
    expect(validateSchedule({ ...ok, runDayOfMonth: 0 })).toHaveProperty("error");
    expect(validateSchedule({ ...ok, runDayOfMonth: 29 })).toHaveProperty("error");
    expect(validateSchedule({ ...ok, minBalance: 0 })).toHaveProperty("error");
    expect(validateSchedule({ ...ok, minBalance: Number.NaN })).toHaveProperty("error");
    expect(validateSchedule({ ...ok, minDaysBetween: 0 })).toHaveProperty("error");
    expect(validateSchedule({ ...ok, minDaysBetween: 91 })).toHaveProperty("error");
  });
});

describe("describeSchedule", () => {
  it("describes weekly, fortnightly and monthly schedules", () => {
    expect(describeSchedule({ ...ok, runWeekday: 1 })).toContain("every Monday");
    expect(describeSchedule({ ...ok, frequency: "fortnightly", runWeekday: 5 })).toContain("every other Friday");
    expect(describeSchedule({ ...ok, frequency: "monthly", runDayOfMonth: 5 })).toContain("day 5 of each month");
    expect(describeSchedule({ ...ok, channel: "whatsapp" })).toContain("WhatsApp");
  });
});

describe("reminderTone", () => {
  it("maps statuses", () => {
    expect(reminderTone("draft")).toBe("warning");
    expect(reminderTone("sent")).toBe("success");
    expect(reminderTone("dismissed")).toBe("neutral");
    expect(reminderTone("cancelled")).toBe("neutral");
  });
});

describe("chunkSlips", () => {
  it("splits into pages of four by default", () => {
    expect(chunkSlips([1, 2, 3, 4, 5, 6, 7, 8, 9]).map((p) => p.length)).toEqual([4, 4, 1]);
  });
  it("handles empty input and invalid page size", () => {
    expect(chunkSlips([])).toEqual([]);
    expect(chunkSlips([1, 2], 0)).toEqual([[1], [2]]);
  });
});

describe("templateProblem", () => {
  it("accepts supported placeholders and plain text", () => {
    expect(templateProblem("Dear {{guardian_name}}, {{student_name}} owes KES {{balance}} at {{school_name}}.")).toBeNull();
    expect(templateProblem("Please check the fee statement.")).toBeNull();
  });
  it("rejects empty, over-long and unknown placeholders (including spaced ones)", () => {
    expect(templateProblem("   ")).toMatch(/empty/);
    expect(templateProblem(null)).toMatch(/empty/);
    expect(templateProblem("x".repeat(1001))).toMatch(/1000/);
    expect(templateProblem("Hi {{nope}}")).toMatch(/\{\{nope\}\}/);
    expect(templateProblem("Owes {{ balance }}")).toMatch(/not supported/);
  });
});

describe("describeSendOutcome", () => {
  it("only 'sent' counts as ok", () => {
    expect(describeSendOutcome("sent").ok).toBe(true);
    for (const o of ["cancelled", "refreshed", "stale", "hold", "weird"]) {
      expect(describeSendOutcome(o).ok).toBe(false);
    }
  });
  it("explains each non-sending outcome", () => {
    expect(describeSendOutcome("refreshed").message).toMatch(/approve again/);
    expect(describeSendOutcome("stale").message).toMatch(/Refresh from template/);
    expect(describeSendOutcome("hold").message).toMatch(/payment/);
    expect(describeSendOutcome("cancelled").message).toMatch(/cancelled/);
  });
});
