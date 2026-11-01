import { describe, expect, it } from "vitest";
import {
  SCHOOL_NOT_RESOLVED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  isSessionExpiredError,
  schoolIdErrorMessage,
} from "./session-expired";

describe("isSessionExpiredError", () => {
  it("is true only for SQLSTATE 42501 (anon denied on auth_school_id)", () => {
    expect(isSessionExpiredError({ code: "42501" })).toBe(true);
    expect(isSessionExpiredError({ code: "PGRST301" })).toBe(false);
    expect(isSessionExpiredError({ code: "23505" })).toBe(false);
    expect(isSessionExpiredError({})).toBe(false);
    expect(isSessionExpiredError(null)).toBe(false);
    expect(isSessionExpiredError(undefined)).toBe(false);
  });
});

describe("schoolIdErrorMessage", () => {
  it("tells the user to sign in again when the session is gone", () => {
    expect(schoolIdErrorMessage({ code: "42501" })).toBe(SESSION_EXPIRED_MESSAGE);
  });
  it("keeps the original message for every other failure (and for 'no school', error = null)", () => {
    expect(schoolIdErrorMessage({ code: "XX000" })).toBe(SCHOOL_NOT_RESOLVED_MESSAGE);
    expect(schoolIdErrorMessage(null)).toBe(SCHOOL_NOT_RESOLVED_MESSAGE);
  });
});
