import { describe, expect, it } from "vitest";
import {
  normaliseCode,
  normaliseMatchKey,
  reconciles,
  sourceForKind,
  totalsByKind,
  unmappedNames,
  validateVoteHead,
  type LedgerLine,
} from "./vote-heads";

describe("vote head validation", () => {
  it("normalises and accepts a good head", () => {
    expect(validateVoteHead({ code: " tuition ", name: " Tuition fees ", kind: "income" })).toEqual({
      value: { code: "TUITION", name: "Tuition fees", kind: "income" },
    });
  });
  it("rejects bad codes, reserved codes, empty names and bad kinds", () => {
    expect("error" in validateVoteHead({ code: "has space", name: "x", kind: "income" })).toBe(true);
    expect("error" in validateVoteHead({ code: "", name: "x", kind: "income" })).toBe(true);
    expect("error" in validateVoteHead({ code: "unmapped", name: "x", kind: "income" })).toBe(true);
    expect("error" in validateVoteHead({ code: "A", name: "  ", kind: "income" })).toBe(true);
    expect("error" in validateVoteHead({ code: "A", name: "x", kind: "asset" })).toBe(true);
    expect("error" in validateVoteHead({ code: "A".repeat(21), name: "x", kind: "expense" })).toBe(true);
  });
  it("normalises like the database", () => {
    expect(normaliseCode(" ab-1 ")).toBe("AB-1");
    expect(normaliseMatchKey("  Tuition ")).toBe("tuition");
    expect(sourceForKind("income")).toBe("invoice_item");
    expect(sourceForKind("expense")).toBe("expense_category");
  });
});

describe("unmappedNames", () => {
  it("dedupes case-insensitively, drops mapped and blank names, sorts", () => {
    expect(unmappedNames(["Lunch", " lunch", "Tuition", "Activity", "  "], ["tuition"])).toEqual(["Activity", "Lunch"]);
  });
});

describe("ledger totals", () => {
  const rows: LedgerLine[] = [
    { voteHeadId: "a", code: "T", name: "T", kind: "income", lines: 2, amount: 100.1 },
    { voteHeadId: null, code: "UNMAPPED", name: "U", kind: "income", lines: 1, amount: 0.2 },
    { voteHeadId: "b", code: "R", name: "R", kind: "expense", lines: 1, amount: 50 },
  ];
  it("sums by kind without float drift", () => {
    expect(totalsByKind(rows)).toEqual({ income: 100.3, expense: 50, net: 50.3 });
  });
  it("reconciles only at zero difference", () => {
    expect(reconciles({ incomeDifference: 0, expenseDifference: 0 })).toBe(true);
    expect(reconciles({ incomeDifference: 0.004, expenseDifference: 0 })).toBe(true);
    expect(reconciles({ incomeDifference: 1, expenseDifference: 0 })).toBe(false);
  });
});
