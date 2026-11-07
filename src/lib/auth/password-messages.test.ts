import { describe, expect, it } from "vitest";
import {
  EMAIL_SEND_FAILED_MESSAGE,
  friendlyPasswordUpdateError,
  PASSWORD_SESSION_MISSING_MESSAGE,
  SUPPORT_EMAIL,
} from "./password-messages";

describe("friendlyPasswordUpdateError", () => {
  it("explains a reused password in plain words", () => {
    expect(friendlyPasswordUpdateError({ code: "same_password", message: "raw" })).toMatch(/different/i);
  });

  it("explains a weak password", () => {
    expect(friendlyPasswordUpdateError({ code: "weak_password", message: "raw" })).toMatch(/too weak/i);
  });

  it("maps a lost session to the session message", () => {
    expect(friendlyPasswordUpdateError({ code: "session_not_found" })).toBe(PASSWORD_SESSION_MISSING_MESSAGE);
    expect(friendlyPasswordUpdateError({ code: "session_expired" })).toBe(PASSWORD_SESSION_MISSING_MESSAGE);
  });

  it("maps a rate limit to a wait-and-retry message", () => {
    expect(friendlyPasswordUpdateError({ code: "over_request_rate_limit" })).toMatch(/wait a minute/i);
  });

  it("keeps Supabase's own message for anything unrecognised, so failures never go vague", () => {
    expect(friendlyPasswordUpdateError({ code: "something_new", message: "Specific upstream text" })).toBe(
      "Specific upstream text",
    );
  });

  it("falls back to a generic message when there is no code or message", () => {
    expect(friendlyPasswordUpdateError(null)).toMatch(/try again/i);
    expect(friendlyPasswordUpdateError({})).toMatch(/try again/i);
  });
});

describe("messages", () => {
  it("points a failed send at the support address", () => {
    expect(EMAIL_SEND_FAILED_MESSAGE).toContain(SUPPORT_EMAIL);
  });

  it("tells a visitor with no session what to do next", () => {
    expect(PASSWORD_SESSION_MISSING_MESSAGE).toMatch(/forgot password/i);
  });
});
