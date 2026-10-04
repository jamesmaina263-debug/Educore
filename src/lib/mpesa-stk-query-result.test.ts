import { describe, expect, it } from "vitest";
import { interpretStkQueryResponse } from "../../supabase/functions/_shared/mpesa/stkQueryResult";

// Real Daraja STK Push Query bodies observed on 2026-10-04 (sandbox) are mirrored below.
const body = (ResultCode: string | number | undefined, ResultDesc = "x") => ({
  ResponseCode: "0",
  ResponseDescription: "The service request has been accepted successfully",
  MerchantRequestID: "m",
  CheckoutRequestID: "ws_CO_1",
  ...(ResultCode === undefined ? {} : { ResultCode, ResultDesc }),
});

describe("interpretStkQueryResponse", () => {
  it("treats ResultCode \"0\" (string, as Daraja sends it) as a confirmed payment", () => {
    expect(interpretStkQueryResponse(200, body("0", "The service request is processed successfully."))).toEqual({
      kind: "success",
      resultCode: 0,
      resultDesc: "The service request is processed successfully.",
    });
  });

  it("accepts a numeric ResultCode too", () => {
    expect(interpretStkQueryResponse(200, body(0)).kind).toBe("success");
  });

  it.each([
    ["2001", 2001], // wrong PIN ("The initiator information is invalid.")
    ["1032", 1032], // cancelled by user
    ["1037", 1037], // prompt timed out
    ["1", 1], // insufficient funds
  ])("treats final failure code %s as failed", (raw, code) => {
    const out = interpretStkQueryResponse(200, body(raw, "desc"));
    expect(out).toEqual({ kind: "failed", resultCode: code, resultDesc: "desc" });
  });

  it("never marks a request failed while Daraja says it is still processing (4999)", () => {
    expect(interpretStkQueryResponse(200, body("4999", "The transaction is still under processing")).kind).toBe(
      "processing",
    );
  });

  it("leaves the request untouched on any non-200 answer (error body, 429 spike arrest, 5xx)", () => {
    expect(
      interpretStkQueryResponse(500, { errorCode: "500.001.1001", errorMessage: "The transaction is being processed" }).kind,
    ).toBe("processing");
    expect(
      interpretStkQueryResponse(429, { fault: { detail: { errorcode: "policies.ratelimit.SpikeArrestViolation" } } }).kind,
    ).toBe("processing");
    expect(interpretStkQueryResponse(502, null).kind).toBe("processing");
  });

  it("does not confuse a 200 with no ResultCode, or garbage, for a result", () => {
    expect(interpretStkQueryResponse(200, body(undefined)).kind).toBe("processing");
    expect(interpretStkQueryResponse(200, body("")).kind).toBe("processing");
    expect(interpretStkQueryResponse(200, body("abc")).kind).toBe("processing");
    expect(interpretStkQueryResponse(200, body("1.5")).kind).toBe("processing");
    expect(interpretStkQueryResponse(200, null).kind).toBe("processing");
    expect(interpretStkQueryResponse(200, "text").kind).toBe("processing");
  });

  it("tolerates a missing ResultDesc", () => {
    expect(interpretStkQueryResponse(200, { ResultCode: "0" })).toEqual({
      kind: "success",
      resultCode: 0,
      resultDesc: "",
    });
  });
});
