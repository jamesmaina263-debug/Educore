import { describe, expect, it } from "vitest";
import {
  buildPayLinkUrl,
  hashPayLinkToken,
  isPayLinkToken,
  normalizeKenyanMsisdn,
  payLinkErrorMessage,
  PAY_LINK_UNAVAILABLE_MESSAGE,
} from "./pay-link";

describe("isPayLinkToken", () => {
  it("accepts exactly 64 lowercase hex characters", () => {
    expect(isPayLinkToken("a".repeat(64))).toBe(true);
    expect(isPayLinkToken("0123456789abcdef".repeat(4))).toBe(true);
  });
  it("rejects everything else", () => {
    expect(isPayLinkToken("a".repeat(63))).toBe(false);
    expect(isPayLinkToken("a".repeat(65))).toBe(false);
    expect(isPayLinkToken("A".repeat(64))).toBe(false);
    expect(isPayLinkToken("g".repeat(64))).toBe(false);
    expect(isPayLinkToken("")).toBe(false);
    expect(isPayLinkToken(`${"a".repeat(63)}/`)).toBe(false);
  });
});

describe("hashPayLinkToken", () => {
  it("is the hex SHA-256 of the token (same as the database)", () => {
    // sha256("abc")
    expect(hashPayLinkToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashPayLinkToken("a".repeat(64))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("normalizeKenyanMsisdn", () => {
  it("normalises common Kenyan formats", () => {
    expect(normalizeKenyanMsisdn("0712345678")).toBe("254712345678");
    expect(normalizeKenyanMsisdn("0712 345 678")).toBe("254712345678");
    expect(normalizeKenyanMsisdn("+254712345678")).toBe("254712345678");
    expect(normalizeKenyanMsisdn("254712345678")).toBe("254712345678");
    expect(normalizeKenyanMsisdn("712345678")).toBe("254712345678");
    expect(normalizeKenyanMsisdn("0112345678")).toBe("254112345678");
  });
  it("rejects anything that is not a Kenyan mobile", () => {
    expect(normalizeKenyanMsisdn("")).toBeNull();
    expect(normalizeKenyanMsisdn("0212345678")).toBeNull();
    expect(normalizeKenyanMsisdn("07123456")).toBeNull();
    expect(normalizeKenyanMsisdn("0712345678901")).toBeNull();
    expect(normalizeKenyanMsisdn("abcdefghij")).toBeNull();
    expect(normalizeKenyanMsisdn("+255712345678")).toBeNull();
  });
});

describe("payLinkErrorMessage", () => {
  it("maps known database codes and hides everything else", () => {
    expect(payLinkErrorMessage("INVALID_PHONE")).toMatch(/valid Safaricom number/);
    expect(payLinkErrorMessage("RATE_LIMITED")).toMatch(/Too many attempts/);
    expect(payLinkErrorMessage("PROMPT_IN_PROGRESS")).toMatch(/approve it/);
    expect(payLinkErrorMessage("LINK_NOT_AVAILABLE")).toBe(PAY_LINK_UNAVAILABLE_MESSAGE);
    expect(payLinkErrorMessage('relation "x" does not exist')).toBe("We could not start the payment. Please try again in a moment.");
    expect(payLinkErrorMessage(null)).toBe("We could not start the payment. Please try again in a moment.");
  });
});

describe("buildPayLinkUrl", () => {
  it("joins origin and token without a double slash", () => {
    expect(buildPayLinkUrl("https://www.educoreafrica.com/", "t".repeat(64))).toBe(`https://www.educoreafrica.com/pay/${"t".repeat(64)}`);
  });
});
