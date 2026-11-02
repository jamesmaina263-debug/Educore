import { describe, expect, it } from "vitest";
import {
  buildC2bConfirmationUrl,
  c2bRegisterEndpoint,
  checkProductionRegistrationState,
  checkProductionUrl,
  checkRegistrationPreconditions,
  confirmationMatches,
  looksLikeAlreadyRegistered,
  redactedUrl,
} from "../../supabase/functions/_shared/mpesa/c2bRegistration";

const SCHOOL = "123e4567-e89b-42d3-a456-426614174000";
const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef";
const ORIGIN = "https://alzqlvfaftwegptfbfej.supabase.co";

const prodOk = {
  flagEnabled: true,
  settings: { shortcode: "4022809", is_active: true, environment: "production", shortcode_type: "paybill" },
  hasCredentials: true,
};

describe("checkRegistrationPreconditions with environment = production", () => {
  it("passes for an active production paybill with credentials and the flag on", () => {
    expect(checkRegistrationPreconditions(prodOk, "production")).toEqual({ ok: true });
  });
  it("refuses a sandbox school, with its own code", () => {
    const r = checkRegistrationPreconditions({ ...prodOk, settings: { ...prodOk.settings, environment: "sandbox" } }, "production");
    expect(r).toMatchObject({ ok: false, code: "not_production" });
  });
  it("still refuses a till, a missing flag, missing credentials and an inactive shortcode", () => {
    expect(checkRegistrationPreconditions({ ...prodOk, settings: { ...prodOk.settings, shortcode_type: "till" } }, "production")).toMatchObject({ code: "till_not_supported" });
    expect(checkRegistrationPreconditions({ ...prodOk, flagEnabled: false }, "production")).toMatchObject({ code: "flag_off" });
    expect(checkRegistrationPreconditions({ ...prodOk, hasCredentials: false }, "production")).toMatchObject({ code: "no_credentials" });
    expect(checkRegistrationPreconditions({ ...prodOk, settings: { ...prodOk.settings, is_active: false } }, "production")).toMatchObject({ code: "no_active_shortcode" });
  });
  it("regression: the default is still sandbox, so the sandbox function behaves exactly as before", () => {
    expect(checkRegistrationPreconditions(prodOk)).toMatchObject({ ok: false, code: "not_sandbox" });
    const sandbox = { ...prodOk, settings: { ...prodOk.settings, environment: "sandbox" } };
    expect(checkRegistrationPreconditions(sandbox)).toEqual({ ok: true });
  });
});

describe("checkProductionRegistrationState", () => {
  it("allows a school that was never registered and is log-only (or has no config row yet)", () => {
    expect(checkProductionRegistrationState({ registeredAt: null, mode: "log_only" })).toEqual({ ok: true });
    expect(checkProductionRegistrationState({ registeredAt: null, mode: null })).toEqual({ ok: true });
  });
  it("refuses a second registration: production is one-time", () => {
    expect(checkProductionRegistrationState({ registeredAt: "2026-11-02T08:00:00Z", mode: "log_only" })).toMatchObject({
      ok: false,
      code: "already_registered",
    });
  });
  it("refuses a school that is not in log-only mode", () => {
    expect(checkProductionRegistrationState({ registeredAt: null, mode: "live" })).toMatchObject({ ok: false, code: "mode_not_log_only" });
  });
});

describe("checkProductionUrl", () => {
  const good = `${ORIGIN}/functions/v1/fees-c2b-confirmation/${SCHOOL}/${TOKEN}`;
  it("accepts the real address shape", () => {
    expect(checkProductionUrl(good)).toEqual({ ok: true });
  });
  it("rejects plain http", () => {
    expect(checkProductionUrl(good.replace("https:", "http:"))).toMatchObject({ ok: false });
  });
  it("rejects every word Safaricom filters, in the host or the path", () => {
    for (const w of ["mpesa", "safaricom", "exe", "exec", "cmd", "sql", "query"]) {
      expect(checkProductionUrl(`https://${w}.example.com/a`)).toMatchObject({ ok: false });
      expect(checkProductionUrl(`https://example.com/${w.toUpperCase()}/a`)).toMatchObject({ ok: false });
    }
  });
  it("rejects tunnel, request-bin and local hosts", () => {
    for (const h of ["abc.ngrok.io", "x.mockbin.org", "webhook.site", "localhost", "127.0.0.1"]) {
      expect(checkProductionUrl(`https://${h}/a`)).toMatchObject({ ok: false });
    }
  });
  it("rejects something that is not a URL", () => {
    expect(checkProductionUrl("not a url")).toMatchObject({ ok: false });
  });
  it("a real address always passes, whatever the school id and token are (hex cannot spell the blocked words)", () => {
    const hex = (n: number) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
    for (let i = 0; i < 500; i++) {
      const school = `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
      const url = buildC2bConfirmationUrl({ supabaseUrl: ORIGIN, schoolId: school, token: hex(48) });
      expect(checkProductionUrl(url)).toEqual({ ok: true });
    }
  });
});

describe("redactedUrl", () => {
  it("hides the token and keeps everything else", () => {
    const url = `${ORIGIN}/functions/v1/fees-c2b-confirmation/${SCHOOL}/${TOKEN}`;
    const shown = redactedUrl(url, TOKEN);
    expect(shown).not.toContain(TOKEN);
    expect(shown).toBe(`${ORIGIN}/functions/v1/fees-c2b-confirmation/${SCHOOL}/<token>`);
  });
});

describe("confirmationMatches", () => {
  it("needs the shortcode typed exactly, as a string", () => {
    expect(confirmationMatches("4022809", "4022809")).toBe(true);
    expect(confirmationMatches(" 4022809 ", "4022809")).toBe(true);
  });
  it("rejects wrong, empty, missing and non-string confirmations", () => {
    expect(confirmationMatches("4022808", "4022809")).toBe(false);
    expect(confirmationMatches("", "4022809")).toBe(false);
    expect(confirmationMatches(undefined, "4022809")).toBe(false);
    expect(confirmationMatches(4022809, "4022809")).toBe(false);
    expect(confirmationMatches(true, "4022809")).toBe(false);
  });
});

describe("looksLikeAlreadyRegistered", () => {
  it("recognises the usual wordings and ignores unrelated errors", () => {
    expect(looksLikeAlreadyRegistered("URLs are already registered")).toBe(true);
    expect(looksLikeAlreadyRegistered("Duplicate notification info")).toBe(true);
    expect(looksLikeAlreadyRegistered("Invalid Access Token")).toBe(false);
  });
});

describe("production endpoint", () => {
  it("is the v2 Register URL on the live host", () => {
    expect(c2bRegisterEndpoint("production")).toBe("https://api.safaricom.co.ke/mpesa/c2b/v2/registerurl");
  });
});
