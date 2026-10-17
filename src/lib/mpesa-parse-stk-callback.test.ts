import { describe, expect, it } from "vitest";
import { parseStkCallback } from "../../supabase/functions/_shared/mpesa/parseStkCallback";

const success = (items: Array<{ Name: string; Value?: string | number }>) => ({
  Body: {
    stkCallback: {
      MerchantRequestID: "29115-34620561-1",
      CheckoutRequestID: "ws_CO_191220191020363925",
      ResultCode: 0,
      ResultDesc: "The service request is processed successfully.",
      CallbackMetadata: { Item: items },
    },
  },
});

const goodItems = [
  { Name: "Amount", Value: 1500 },
  { Name: "MpesaReceiptNumber", Value: "NLJ7RT61SV" },
  { Name: "TransactionDate", Value: 20191219102115 },
  { Name: "PhoneNumber", Value: 254708374149 },
];

describe("parseStkCallback", () => {
  it("accepts a genuine success callback", () => {
    const r = parseStkCallback(success(goodItems));
    expect(r).toEqual({
      ok: true,
      checkoutRequestId: "ws_CO_191220191020363925",
      resultCode: 0,
      resultDesc: "The service request is processed successfully.",
      amount: 1500,
      receiptNumber: "NLJ7RT61SV",
      phoneNumber: "254708374149",
    });
  });

  it("rejects a success with no Amount", () => {
    const r = parseStkCallback(success(goodItems.filter((i) => i.Name !== "Amount")));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.isSuccessCode).toBe(true);
  });

  it("rejects a success with no receipt, a junk receipt, or a non-positive amount", () => {
    expect(parseStkCallback(success(goodItems.filter((i) => i.Name !== "MpesaReceiptNumber"))).ok).toBe(false);
    expect(
      parseStkCallback(success(goodItems.map((i) => (i.Name === "MpesaReceiptNumber" ? { ...i, Value: "x; drop table" } : i)))).ok,
    ).toBe(false);
    expect(parseStkCallback(success(goodItems.map((i) => (i.Name === "Amount" ? { ...i, Value: 0 } : i)))).ok).toBe(false);
    expect(parseStkCallback(success(goodItems.map((i) => (i.Name === "Amount" ? { ...i, Value: "1500" } : i)))).ok).toBe(false);
  });

  it("accepts a failure callback that has no metadata (Safaricom sends none)", () => {
    const r = parseStkCallback({
      Body: { stkCallback: { CheckoutRequestID: "ws_CO_1", ResultCode: 1032, ResultDesc: "Request cancelled by user" } },
    });
    expect(r).toMatchObject({ ok: true, resultCode: 1032, amount: null, receiptNumber: null });
  });

  it("rejects malformed bodies without throwing", () => {
    for (const body of [null, undefined, {}, { Body: {} }, { Body: { stkCallback: {} } }, "string", 42, []]) {
      const r = parseStkCallback(body);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.isSuccessCode).toBe(false);
    }
  });

  it("rejects a non-integer ResultCode and an oversized CheckoutRequestID", () => {
    expect(parseStkCallback({ Body: { stkCallback: { CheckoutRequestID: "a", ResultCode: "0" } } }).ok).toBe(false);
    expect(parseStkCallback({ Body: { stkCallback: { CheckoutRequestID: "a", ResultCode: 0.5 } } }).ok).toBe(false);
    expect(parseStkCallback({ Body: { stkCallback: { CheckoutRequestID: "a".repeat(101), ResultCode: 1 } } }).ok).toBe(false);
  });

  it("tolerates a non-array Item", () => {
    const r = parseStkCallback({
      Body: { stkCallback: { CheckoutRequestID: "ws_CO_1", ResultCode: 0, CallbackMetadata: { Item: "nope" } } },
    });
    expect(r.ok).toBe(false);
  });
});
