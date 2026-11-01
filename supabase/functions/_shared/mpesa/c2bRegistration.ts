// Pure helpers for registering a school's C2B confirmation URL with Daraja (sandbox only for now).
//
// Kept free of Deno/Supabase imports so it can be unit-tested with vitest (see
// src/lib/mpesa-c2b-registration.test.ts).
//
// The ConfirmationURL ends in <school_id>/<confirmation_token>, and the token is a secret. So
// nothing here ever returns, logs or embeds the token anywhere except the URL that is sent to
// Daraja, and redactToken() exists so error text coming back from Daraja can be scrubbed before it
// is stored or returned.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[0-9a-f]{48}$/;
const SHORTCODE_RE = /^[0-9]{4,10}$/;

export const C2B_FUNCTION_NAME = "fees-c2b-confirmation";
export const C2B_FLAG_KEY = "feature.finance.c2b_capture";
// Daraja rejects registered URLs containing any of these words.
export const DARAJA_FORBIDDEN_URL_WORDS = ["mpesa", "safaricom", "exe", "exec", "cme", "cmd", "sql", "query"] as const;

export function buildC2bConfirmationUrl(params: { supabaseUrl: string; schoolId: string; token: string }): string {
  const base = params.supabaseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(base)) throw new Error("supabaseUrl must be an https origin.");
  if (!UUID_RE.test(params.schoolId)) throw new Error("schoolId must be a UUID.");
  if (!TOKEN_RE.test(params.token)) throw new Error("token must be 48 lowercase hex characters.");
  const url = `${base}/functions/v1/${C2B_FUNCTION_NAME}/${params.schoolId.toLowerCase()}/${params.token}`;
  // The word check applies to the path only: the project host is fixed and not ours to change.
  const path = url.slice(base.length).toLowerCase();
  for (const word of DARAJA_FORBIDDEN_URL_WORDS) {
    if (path.includes(word)) throw new Error(`Registered URL path must not contain "${word}".`);
  }
  return url;
}

export interface C2bRegisterRequest {
  ShortCode: string;
  ResponseType: "Completed";
  ConfirmationURL: string;
  ValidationURL: string;
}

// Register URL v2 (so Safaricom sends the payer's phone masked). ValidationURL is mandatory in the
// API even though validation stays switched off; the same URL is used. "Completed" means M-Pesa
// completes the payment if validation cannot be reached, which is the only safe choice for fees.
export function buildC2bRegisterRequest(params: { shortcode: string; confirmationUrl: string }): C2bRegisterRequest {
  if (!SHORTCODE_RE.test(params.shortcode)) throw new Error("shortcode must be 4-10 digits.");
  return {
    ShortCode: params.shortcode,
    ResponseType: "Completed",
    ConfirmationURL: params.confirmationUrl,
    ValidationURL: params.confirmationUrl,
  };
}

export function c2bRegisterEndpoint(environment: "sandbox" | "production"): string {
  const base = environment === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
  return `${base}/mpesa/c2b/v2/registerurl`;
}

export interface RegistrationInputs {
  flagEnabled: boolean;
  settings: { shortcode: string | null; is_active: boolean | null; environment: string | null; shortcode_type?: string | null } | null;
  hasCredentials: boolean;
}

export type PreconditionResult = { ok: true } | { ok: false; code: string; message: string };

// Order matters only for which message the admin sees first.
export function checkRegistrationPreconditions(i: RegistrationInputs): PreconditionResult {
  if (!i.flagEnabled) {
    return { ok: false, code: "flag_off", message: `Feature flag ${C2B_FLAG_KEY} is not enabled for this school.` };
  }
  if (!i.settings || !i.settings.is_active || !i.settings.shortcode || !SHORTCODE_RE.test(String(i.settings.shortcode).trim())) {
    return { ok: false, code: "no_active_shortcode", message: "The school has no active M-Pesa shortcode." };
  }
  // Paybill auto-capture matches the account number to an admission number. A till (Buy Goods) payment
  // carries no account number, so it could never be matched automatically: refuse rather than register.
  if (i.settings.shortcode_type === "till") {
    return {
      ok: false,
      code: "till_not_supported",
      message: "Paybill auto-capture needs a paybill. This school uses a till, which carries no account number.",
    };
  }
  if (!i.hasCredentials) {
    return { ok: false, code: "no_credentials", message: "The school has no saved Daraja credentials." };
  }
  if (i.settings.environment !== "sandbox") {
    return {
      ok: false,
      code: "not_sandbox",
      message: "Only sandbox registration is supported here. Production registration is a separate, once-only step.",
    };
  }
  return { ok: true };
}

export type RegisterOutcome = { ok: true; description: string } | { ok: false; reason: string };

// Daraja answers {ResponseCode: "0", ResponseDescription: "Success"} (field names vary slightly
// between products), or an error object. Anything that is not an explicit success is a failure.
export function interpretC2bRegisterResponse(httpStatus: number, body: unknown): RegisterOutcome {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const code = b.ResponseCode ?? b.responseCode;
  const desc = String(b.ResponseDescription ?? b.errorMessage ?? b.ResponseDesc ?? "").slice(0, 200);
  // Daraja sandbox answers "00000000"; other products answer "0". Both mean success.
  if (httpStatus >= 200 && httpStatus < 300 && /^0+$/.test(String(code ?? "").trim())) {
    return { ok: true, description: desc || "Success" };
  }
  return { ok: false, reason: desc || `HTTP ${httpStatus}` };
}

// Removes the secret (and the full URL containing it) from any text before it is stored or returned.
export function redactToken(text: string, token: string): string {
  if (!token) return text;
  return text.split(token).join("[redacted]");
}
