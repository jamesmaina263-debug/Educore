import { describe, expect, it } from "vitest";
import { isSignupReviewDecision, signupReviewGate } from "./signup-review";

describe("signupReviewGate", () => {
  it("holds a pending school and blocks a rejected one", () => {
    expect(signupReviewGate("pending")).toBe("pending");
    expect(signupReviewGate("rejected")).toBe("rejected");
  });

  it("allows approved schools", () => {
    expect(signupReviewGate("approved")).toBe("allow");
  });

  it("never locks anyone out when the value is missing or unexpected", () => {
    for (const v of [undefined, null, "", "PENDING", "weird", 0, {}]) {
      expect(signupReviewGate(v)).toBe("allow");
    }
  });
});

describe("isSignupReviewDecision", () => {
  it("accepts only approved or rejected", () => {
    expect(isSignupReviewDecision("approved")).toBe(true);
    expect(isSignupReviewDecision("rejected")).toBe(true);
    expect(isSignupReviewDecision("pending")).toBe(false);
    expect(isSignupReviewDecision("")).toBe(false);
    expect(isSignupReviewDecision(undefined)).toBe(false);
  });
});
