import { describe, expect, it } from "vitest";
import {
  buildC2bConfirmationUrl,
  buildC2bRegisterRequest,
  c2bRegisterEndpoint,
  checkRegistrationPreconditions,
  DARAJA_FORBIDDEN_URL_WORDS,
  interpretC2bRegisterResponse,
  redactToken,
} from "../../supabase/functions/_shared/mpesa/c2bRegistration";

const SCHOOL = "123e4567-e89b-42d3-a456-426614174000";
const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef";
const ORIGIN = "https://alzqlvfaftwegptfbfej.supabase.co";

describe("buildC2bConfirmationUrl", () => {
  it("builds the documented URL shape", () => {
    expect(buildC2bConfirmationUrl({ supabaseUrl: ORIGIN, schoolId: SCHOOL, token: TOKEN })).toBe(
      `${ORIGIN}/functions/v1/fees-c2b-confirmation/${SCHOOL}/${TOKEN}`,
    );
  });
  it("tolerates a trailing slash on the origin", () => {
    expect(buildC2bConfirmationUrl({ supabaseUrl: `${ORIGIN}/`, schoolId: SCHOOL, token: TOKEN })).toContain(
      "/functions/v1/fees-c2b-confirmation/",
    );
  });
  it("lowercases the school id", () => {
    expect(
      buildC2bConfirmationUrl({ supabaseUrl: ORIGIN, schoolId: SCHOOL.toUpperCase(), token: TOKEN }),
    ).toContain(`/${SCHOOL}/`);
  });
  it("rejects http, bad ids and malformed tokens", () => {
    expect(() => buildC2bConfirmationUrl({ supabaseUrl: "http://x.co", schoolId: SCHOOL, token: TOKEN })).toThrow();
    expect(() => buildC2bConfirmationUrl({ supabaseUrl: ORIGIN, schoolId: "nope", token: TOKEN })).toThrow();
    expect(() => buildC2bConfirmationUrl({ supabaseUrl: ORIGIN, schoolId: SCHOOL, token: "abc" })).toThrow();
    expect(() => buildC2bConfirmationUrl({ supabaseUrl: ORIGIN, schoolId: SCHOOL, token: TOKEN.toUpperCase() })).toThrow();
  });
  it("produces a path free of every word Daraja rejects", () => {
    const path = new URL(buildC2bConfirmationUrl({ supabaseUrl: ORIGIN, schoolId: SCHOOL, token: TOKEN })).pathname;
    for (const w of DARAJA_FORBIDDEN_URL_WORDS) expect(path.toLowerCase()).not.toContain(w);
  });
});

describe("buildC2bRegisterRequest", () => {
  const url = buildC2bConfirmationUrl({ supabaseUrl: ORIGIN, schoolId: SCHOOL, token: TOKEN });
  it("uses Completed and the same URL for both fields", () => {
    expect(buildC2bRegisterRequest({ shortcode: "600000", confirmationUrl: url })).toEqual({
      ShortCode: "600000",
      ResponseType: "Completed",
      ConfirmationURL: url,
      ValidationURL: url,
    });
  });
  it("rejects a non-numeric shortcode", () => {
    expect(() => buildC2bRegisterRequest({ shortcode: "60A000", confirmationUrl: url })).toThrow();
  });
});

describe("c2bRegisterEndpoint", () => {
  it("targets the v2 endpoint per environment", () => {
    expect(c2bRegisterEndpoint("sandbox")).toBe("https://sandbox.safaricom.co.ke/mpesa/c2b/v2/registerurl");
    expect(c2bRegisterEndpoint("production")).toBe("https://api.safaricom.co.ke/mpesa/c2b/v2/registerurl");
  });
});

describe("checkRegistrationPreconditions", () => {
  const good = {
    flagEnabled: true,
    settings: { shortcode: "600000", is_active: true, environment: "sandbox" },
    hasCredentials: true,
  };
  it("passes when everything is in place", () => {
    expect(checkRegistrationPreconditions(good)).toEqual({ ok: true });
  });
  it("refuses with the flag off", () => {
    expect(checkRegistrationPreconditions({ ...good, flagEnabled: false })).toMatchObject({ ok: false, code: "flag_off" });
  });
  it("refuses with no settings, inactive settings or no shortcode", () => {
    expect(checkRegistrationPreconditions({ ...good, settings: null })).toMatchObject({ code: "no_active_shortcode" });
    expect(
      checkRegistrationPreconditions({ ...good, settings: { ...good.settings, is_active: false } }),
    ).toMatchObject({ code: "no_active_shortcode" });
    expect(
      checkRegistrationPreconditions({ ...good, settings: { ...good.settings, shortcode: null } }),
    ).toMatchObject({ code: "no_active_shortcode" });
  });
  it("refuses without credentials", () => {
    expect(checkRegistrationPreconditions({ ...good, hasCredentials: false })).toMatchObject({ code: "no_credentials" });
  });
  it("refuses production, and any environment that is not exactly sandbox", () => {
    expect(
      checkRegistrationPreconditions({ ...good, settings: { ...good.settings, environment: "production" } }),
    ).toMatchObject({ ok: false, code: "not_sandbox" });
    expect(
      checkRegistrationPreconditions({ ...good, settings: { ...good.settings, environment: null } }),
    ).toMatchObject({ code: "not_sandbox" });
  });
});

describe("interpretC2bRegisterResponse", () => {
  it("accepts an explicit success", () => {
    expect(interpretC2bRegisterResponse(200, { ResponseCode: "0", ResponseDescription: "Success" })).toEqual({
      ok: true,
      description: "Success",
    });
  });
  it("rejects HTTP errors, non-zero codes and non-JSON bodies", () => {
    expect(interpretC2bRegisterResponse(400, { errorMessage: "Invalid ShortCode" })).toEqual({
      ok: false,
      reason: "Invalid ShortCode",
    });
    expect(interpretC2bRegisterResponse(200, { ResponseCode: "1", ResponseDescription: "bad" })).toMatchObject({ ok: false });
    expect(interpretC2bRegisterResponse(500, null)).toEqual({ ok: false, reason: "HTTP 500" });
  });
  it("does not treat a 200 without a ResponseCode as success", () => {
    expect(interpretC2bRegisterResponse(200, {})).toMatchObject({ ok: false });
  });
});

describe("redactToken", () => {
  it("removes every occurrence of the token", () => {
    expect(redactToken(`bad url /x/${TOKEN} and ${TOKEN}`, TOKEN)).toBe("bad url /x/[redacted] and [redacted]");
  });
  it("leaves text alone when there is no token", () => {
    expect(redactToken("hello", "")).toBe("hello");
  });
});
