import { describe, it, expect } from "vitest";
import { expectedLastPeriod, formatPeriod, monthsToClear, parseDue, toCents, validateAgreementDate, validateLoan, validateMoney, validateReason, type LoanInput } from "./staff-loans";

const base: LoanInput = { staffId: "s", kind: "loan", principal: "30000", installment: "5000", firstYear: 2026, firstMonth: 3, reason: " School fees " };

describe("money", () => {
  it("accepts shillings with up to two decimals and rejects the rest", () => {
    expect(validateMoney("500", 1000)).toEqual({ value: 500 });
    expect(validateMoney(" 10.55 ", 1000)).toEqual({ value: 10.55 });
    for (const bad of ["", "0", "-5", "10.555", "1e3", "abc", "1,000", "1001"]) expect("error" in validateMoney(bad, 1000)).toBe(true);
  });
  it("works in whole cents", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
});

describe("validateLoan", () => {
  it("accepts a good loan and trims the reason", () => {
    const r = validateLoan(base);
    expect("value" in r && r.value).toMatchObject({ principal: 30000, installment: 5000, reason: "School fees" });
  });
  it("rejects a missing person, an unknown kind and bad amounts", () => {
    expect("error" in validateLoan({ ...base, staffId: "" })).toBe(true);
    expect("error" in validateLoan({ ...base, kind: "gift" as never })).toBe(true);
    expect("error" in validateLoan({ ...base, principal: "0" })).toBe(true);
    expect("error" in validateLoan({ ...base, principal: "5000001" })).toBe(true);
    expect("error" in validateLoan({ ...base, installment: "30000.01" })).toBe(true);
  });
  it("allows the instalment to equal the amount lent (a one-month advance)", () => {
    expect("error" in validateLoan({ ...base, kind: "advance", principal: "10000", installment: "10000" })).toBe(false);
  });
  it("rejects a bad first period and a long reason", () => {
    expect("error" in validateLoan({ ...base, firstMonth: 13 })).toBe(true);
    expect("error" in validateLoan({ ...base, firstYear: 1999 })).toBe(true);
    expect("error" in validateLoan({ ...base, reason: "x".repeat(201) })).toBe(true);
  });
});

describe("schedule", () => {
  it("counts the months to clear, rounding up", () => {
    expect(monthsToClear(30000, 5000)).toBe(6);
    expect(monthsToClear(6000, 5000)).toBe(2);
    expect(monthsToClear(0, 5000)).toBe(0);
    expect(monthsToClear(0.3, 0.1)).toBe(3);
  });
  it("works out the last month, across year ends", () => {
    expect(expectedLastPeriod(2026, 3, 6)).toEqual({ year: 2026, month: 8 });
    expect(expectedLastPeriod(2026, 11, 4)).toEqual({ year: 2027, month: 2 });
    expect(expectedLastPeriod(2026, 12, 1)).toEqual({ year: 2026, month: 12 });
    expect(expectedLastPeriod(2026, 1, 0)).toBeNull();
  });
  it("names a period", () => {
    expect(formatPeriod(2026, 3)).toBe("March 2026");
  });
});

describe("agreement date and reasons", () => {
  it("needs a real, non-future date", () => {
    expect(validateAgreementDate("2026-02-20", "2026-11-05")).toEqual({ value: "2026-02-20" });
    expect("error" in validateAgreementDate("2026-12-01", "2026-11-05")).toBe(true);
    expect("error" in validateAgreementDate("", "2026-11-05")).toBe(true);
    expect("error" in validateAgreementDate("20/02/2026", "2026-11-05")).toBe(true);
  });
  it("needs a sensible reason", () => {
    expect(validateReason("  Hardship ")).toEqual({ value: "Hardship" });
    expect("error" in validateReason("ab")).toBe(true);
    expect("error" in validateReason("x".repeat(201))).toBe(true);
  });
});

describe("parseDue", () => {
  it("reads the database answer", () => {
    expect(parseDue({ total: "2283.33", capped: true, cap: "2283.33", lines: [{ loan_id: "l", kind: "loan", amount: "2283.33", name: "Staff loan repayment" }] })).toEqual({
      total: 2283.33, capped: true, cap: 2283.33, lines: [{ loanId: "l", kind: "loan", amount: 2283.33, name: "Staff loan repayment" }],
    });
  });
  it("returns null for nothing", () => {
    expect(parseDue(null)).toBeNull();
    expect(parseDue({})).toBeNull();
  });
});
