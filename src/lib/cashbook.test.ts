import { describe, expect, it } from "vitest";
import {
  accountLabel,
  defaultWindow,
  isTruncated,
  kenyaDay,
  parseDateParam,
  reconciles,
  resolveWindow,
  summaryTotals,
  withRunningBalance,
  type CashbookEntry,
} from "./cashbook";

const entry = (over: Partial<CashbookEntry>): CashbookEntry => ({
  entryDate: "2026-03-10",
  kind: "receipt",
  account: "cash",
  reference: null,
  description: "Payment",
  moneyIn: 0,
  moneyOut: 0,
  sourceId: "x",
  ...over,
});

describe("parseDateParam", () => {
  it("accepts real dates only", () => {
    expect(parseDateParam("2026-03-10")).toBe("2026-03-10");
    expect(parseDateParam("2026-02-30")).toBeNull();
    expect(parseDateParam("2026-3-1")).toBeNull();
    expect(parseDateParam("garbage")).toBeNull();
    expect(parseDateParam("")).toBeNull();
    expect(parseDateParam(undefined)).toBeNull();
  });
});

describe("Kenya dates", () => {
  it("uses the Kenya calendar day, not UTC", () => {
    expect(kenyaDay(new Date("2026-03-10T22:30:00Z"))).toBe("2026-03-11");
    expect(kenyaDay(new Date("2026-03-10T20:59:00Z"))).toBe("2026-03-10");
  });
  it("defaults to the current month so far", () => {
    expect(defaultWindow(new Date("2026-11-04T05:00:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-04" });
  });
  it("falls back for bad input and swaps reversed dates", () => {
    const now = new Date("2026-11-04T05:00:00Z");
    expect(resolveWindow("nope", undefined, now)).toEqual({ from: "2026-11-01", to: "2026-11-04" });
    expect(resolveWindow("2026-03-12", "2026-03-10", now)).toEqual({ from: "2026-03-10", to: "2026-03-12" });
    expect(resolveWindow("2026-03-01", "2026-03-31", now)).toEqual({ from: "2026-03-01", to: "2026-03-31" });
  });
});

describe("withRunningBalance", () => {
  it("starts from the opening balance and follows each entry", () => {
    const rows = withRunningBalance(
      [entry({ moneyIn: 1000 }), entry({ kind: "expense", moneyOut: 300.5 }), entry({ kind: "reversal", moneyOut: 100 })],
      500,
    );
    expect(rows.map((r) => r.balance)).toEqual([1500, 1199.5, 1099.5]);
  });
  it("can go negative (expenses are booked before money is recorded)", () => {
    expect(withRunningBalance([entry({ kind: "expense", moneyOut: 800 })], 0)[0].balance).toBe(-800);
  });
  it("returns nothing for no entries", () => {
    expect(withRunningBalance([], 100)).toEqual([]);
  });
});

describe("summaryTotals and reconciles", () => {
  it("adds accounts up", () => {
    const t = summaryTotals([
      { account: "cash", opening: 1000, moneyIn: 0, moneyOut: 0, closing: 1000, entries: 0 },
      { account: "mpesa", opening: 0, moneyIn: 2900, moneyOut: 500, closing: 2400, entries: 3 },
      { account: "unspecified", opening: 0, moneyIn: 0, moneyOut: 800, closing: -800, entries: 1 },
    ]);
    expect(t).toEqual({ opening: 1000, moneyIn: 2900, moneyOut: 1300, closing: 2600, entries: 4 });
  });
  it("is reconciled only when every difference is exactly zero", () => {
    expect(reconciles({ receiptsDifference: 0, reversalsDifference: 0, expensesDifference: 0 })).toBe(true);
    expect(reconciles({ receiptsDifference: 0, reversalsDifference: 0, expensesDifference: 0.01 })).toBe(false);
    expect(reconciles({ receiptsDifference: -5, reversalsDifference: 0, expensesDifference: 0 })).toBe(false);
  });
});

describe("labels and truncation", () => {
  it("labels known accounts and passes unknown ones through", () => {
    expect(accountLabel("mpesa")).toBe("M-Pesa");
    expect(accountLabel("unspecified")).toContain("Not recorded");
    expect(accountLabel("wire")).toBe("wire");
  });
  it("flags a window with more entries than shown", () => {
    expect(isTruncated(2500, 2000)).toBe(true);
    expect(isTruncated(2000, 2000)).toBe(false);
  });
});
