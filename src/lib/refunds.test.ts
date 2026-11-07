import { describe, expect, it } from "vitest";
import {
  canCancel,
  canDecide,
  canRecordPayout,
  methodLabel,
  parseWholeKes,
  reasonLabel,
  refundErrorMessage,
  statusLabel,
  summarise,
  validatePayoutForm,
  validateRequestForm,
} from "./refunds";

describe("parseWholeKes", () => {
  it("accepts plain whole shillings, with separators typed by people", () => {
    expect(parseWholeKes("2000")).toBe(2000);
    expect(parseWholeKes(" 2,000 ")).toBe(2000);
    expect(parseWholeKes("1 500")).toBe(1500);
  });
  it("refuses everything that is not a whole amount above zero", () => {
    for (const bad of ["", "0", "00", "-5", "100.5", "1e3", "12abc", "abc", "0x10", "1234567890", "٣"]) {
      expect(parseWholeKes(bad)).toBeNull();
    }
  });
});

describe("validateRequestForm", () => {
  const ok = { paymentId: "p1", amountText: "500", reason: "overpayment" as const, note: "" };
  it("accepts a complete form", () => expect(validateRequestForm(ok)).toBeNull());
  it("needs a payment, a whole amount and a reason", () => {
    expect(validateRequestForm({ ...ok, paymentId: "" })).toMatch(/payment/i);
    expect(validateRequestForm({ ...ok, amountText: "10.5" })).toMatch(/whole number/i);
    expect(validateRequestForm({ ...ok, reason: "" })).toMatch(/reason/i);
  });
  it("needs a note for 'other' and limits note length", () => {
    expect(validateRequestForm({ ...ok, reason: "other", note: "   " })).toMatch(/describe/i);
    expect(validateRequestForm({ ...ok, reason: "other", note: "Wrong child" })).toBeNull();
    expect(validateRequestForm({ ...ok, note: "x".repeat(501) })).toMatch(/too long/i);
    expect(validateRequestForm({ ...ok, note: "x".repeat(500) })).toBeNull();
  });
});

describe("validatePayoutForm", () => {
  it("needs a method and a reference", () => {
    expect(validatePayoutForm({ method: "", reference: "X" })).toMatch(/how/i);
    expect(validatePayoutForm({ method: "mpesa", reference: "   " })).toMatch(/reference/i);
    expect(validatePayoutForm({ method: "mpesa", reference: "x".repeat(101) })).toMatch(/too long/i);
    expect(validatePayoutForm({ method: "bank", reference: " BNK-1 " })).toBeNull();
  });
});

describe("status rules mirror the database", () => {
  it("only a waiting request can be decided, only an approved one paid, a paid one is final", () => {
    expect(canDecide("requested")).toBe(true);
    expect(canDecide("approved")).toBe(false);
    expect(canRecordPayout("approved")).toBe(true);
    expect(canRecordPayout("requested")).toBe(false);
    expect(canRecordPayout("paid")).toBe(false);
    expect(canCancel("requested")).toBe(true);
    expect(canCancel("approved")).toBe(true);
    for (const s of ["paid", "rejected", "cancelled"]) expect(canCancel(s)).toBe(false);
  });
});

describe("labels and messages", () => {
  it("has plain labels and falls back to the raw code", () => {
    expect(statusLabel("requested")).toBe("Waiting for approval");
    expect(statusLabel("weird")).toBe("weird");
    expect(reasonLabel("other")).toBe("Other");
    expect(reasonLabel("paid_in_error")).toBe("Paid in error");
    expect(methodLabel("mpesa")).toBe("M-Pesa");
    expect(methodLabel("x")).toBe("x");
  });
  it("shows the database's own message, replacing only empty or network noise", () => {
    expect(refundErrorMessage("Refund exceeds the learner's credit balance (KES 100 available).")).toBe("Refund exceeds the learner's credit balance (KES 100 available).");
    expect(refundErrorMessage("")).toMatch(/Nothing was changed/);
    expect(refundErrorMessage(null)).toMatch(/Nothing was changed/);
    expect(refundErrorMessage("fetch failed")).toMatch(/Could not reach the server/);
  });
});

describe("summarise", () => {
  it("counts open and paid separately and ignores rejected and cancelled", () => {
    expect(
      summarise([
        { status: "requested", amount: 100 },
        { status: "approved", amount: 200 },
        { status: "paid", amount: 300 },
        { status: "rejected", amount: 400 },
        { status: "cancelled", amount: 500 },
      ]),
    ).toEqual({ openCount: 2, openAmount: 300, paidCount: 1, paidAmount: 300 });
    expect(summarise([])).toEqual({ openCount: 0, openAmount: 0, paidCount: 0, paidAmount: 0 });
  });
});
