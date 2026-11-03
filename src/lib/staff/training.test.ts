import { describe, expect, it } from "vitest";
import {
  dueLabel,
  overviewCounts,
  parseWindow,
  sortRecords,
  urgency,
  validateTraining,
  type OverviewRow,
  type TrainingInput,
  type TrainingRecord,
} from "./training";

const base: TrainingInput = {
  id: null,
  staffId: "s1",
  title: "Safeguarding refresher",
  provider: "",
  category: "safeguarding",
  status: "completed",
  startDate: "2026-10-01",
  endDate: "",
  hours: "",
  expiresOn: "",
  notes: "",
};

describe("validateTraining", () => {
  it("accepts a normal record and trims the title", () => {
    const r = validateTraining({ ...base, title: "  First aid " });
    expect("value" in r && r.value.title).toBe("First aid");
  });
  it("requires a staff member and a title", () => {
    expect(validateTraining({ ...base, staffId: "" })).toHaveProperty("error");
    expect(validateTraining({ ...base, title: "  " })).toHaveProperty("error");
    expect(validateTraining({ ...base, title: "x".repeat(151) })).toHaveProperty("error");
  });
  it("rejects impossible dates and reversed ranges", () => {
    expect(validateTraining({ ...base, startDate: "2026-02-31" })).toHaveProperty("error");
    expect(validateTraining({ ...base, endDate: "2026-09-30" })).toHaveProperty("error");
    expect(validateTraining({ ...base, expiresOn: "2026-09-30" })).toHaveProperty("error");
  });
  it("accepts an expiry on or after the start", () => {
    expect(validateTraining({ ...base, expiresOn: "2027-10-01" })).toHaveProperty("value");
  });
  it("parses hours to one decimal and rejects bad values", () => {
    const ok = validateTraining({ ...base, hours: "4.56" });
    expect("hours" in ok && ok.hours).toBe(4.6);
    expect(validateTraining({ ...base, hours: "-1" })).toHaveProperty("error");
    expect(validateTraining({ ...base, hours: "abc" })).toHaveProperty("error");
    expect(validateTraining({ ...base, hours: "1001" })).toHaveProperty("error");
    const none = validateTraining(base);
    expect("hours" in none && none.hours).toBeNull();
  });
  it("rejects a status the form cannot create", () => {
    expect(validateTraining({ ...base, status: "cancelled" as never })).toHaveProperty("error");
  });
});

describe("roll-up helpers", () => {
  const row = (daysLeft: number): OverviewRow => ({ kind: "contract", staffId: "s", staffName: "n", label: "l", dueDate: "2026-11-02", daysLeft });
  it("labels due dates", () => {
    expect(dueLabel(-1)).toBe("Overdue by 1 day");
    expect(dueLabel(-3)).toBe("Overdue by 3 days");
    expect(dueLabel(0)).toBe("Due today");
    expect(dueLabel(1)).toBe("In 1 day");
    expect(dueLabel(12)).toBe("In 12 days");
  });
  it("classifies urgency", () => {
    expect(urgency(-1)).toBe("overdue");
    expect(urgency(0)).toBe("soon");
    expect(urgency(14)).toBe("soon");
    expect(urgency(15)).toBe("later");
  });
  it("counts by urgency", () => {
    expect(overviewCounts([row(-5), row(3), row(14), row(30), row(90)])).toEqual({ overdue: 1, soon: 2, later: 2 });
  });
  it("parses the window, falling back to 90", () => {
    expect(parseWindow("30")).toBe(30);
    expect(parseWindow("365")).toBe(365);
    expect(parseWindow("45")).toBe(90);
    expect(parseWindow(undefined)).toBe(90);
    expect(parseWindow("abc")).toBe(90);
  });
});

describe("sortRecords", () => {
  const rec = (id: string, startDate: string, status: TrainingRecord["status"] = "completed", staffName = "A"): TrainingRecord => ({
    id, staffId: "s", staffName, title: id, provider: null, category: "cpd", status, startDate, endDate: null, hours: null, expiresOn: null, notes: null,
  });
  it("puts newest first and cancelled last", () => {
    const r = sortRecords([rec("old", "2026-01-01"), rec("gone", "2026-12-01", "cancelled"), rec("new", "2026-10-01")]);
    expect(r.map((x) => x.id)).toEqual(["new", "old", "gone"]);
  });
});
