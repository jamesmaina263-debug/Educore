import { createClient } from "jsr:@supabase/supabase-js@2.112.4";
import { verifyCallbackSource } from "../_shared/mpesa/verifyCallbackSource.ts";
import { sendSecurityAlert } from "../_shared/securityAlert.ts";
import {
  MAX_C2B_BODY_BYTES,
  parseC2bConfirmation,
  parseC2bPath,
} from "../_shared/mpesa/parseC2bConfirmation.ts";

// Public webhook Safaricom calls for Daraja C2B (paybill) confirmations -- no Supabase session, so
// this function is deployed with verify_jwt = false (see supabase/config.toml).
//
// The function name and path deliberately avoid the words Daraja refuses in registered URLs
// (mpesa, safaricom, exe, exec, cme, cmd, sql, query). Do not rename it to include any of them.
//
// Same layers as mpesa-stk-callback: the URL path (/fees-c2b-confirmation/<school_id>/<token>) is
// the shared secret, with the token taken from mpesa_c2b_config (its own random value, separate
// from the STK callback_token); Safaricom's published source IPs are the second layer; the body
// is size-capped and strictly parsed; and BusinessShortCode must equal the school's configured
// shortcode. It ALWAYS returns 200 {ResultCode: 0}, because Safaricom retries anything else and
// retries cannot fix a rejected or failed request -- real failures are logged and alerted instead.
// c2b_ingest_payment() is itself idempotent on the M-Pesa TransID.
//
// Nothing is recorded as money unless the school has feature.finance.c2b_capture on AND its mode
// is 'live'; otherwise c2b_ingest_payment() only logs the event and what it would have done.
// This function has no URL registered with Safaricom until a later, separate step.

Deno.serve(async (req) => {
  const alwaysOk = () =>
    new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  try {
    const sourceCheck = verifyCallbackSource(req);
    if (!sourceCheck.enforced) {
      console.warn(
        "fees-c2b-confirmation: IP allowlist enforcement is DISABLED (MPESA_CALLBACK_IP_ALLOWLIST_ENFORCE=false) -- accepting from",
        sourceCheck.sourceIp,
      );
    } else if (!sourceCheck.allowed) {
      console.error("fees-c2b-confirmation: rejected request from IP outside Safaricom's allowlist", sourceCheck.sourceIp);
      void sendSecurityAlert("C2B confirmation rejected: IP outside Safaricom allowlist", {
        ip: sourceCheck.sourceIp ?? "unknown",
      });
      return alwaysOk();
    }

    const path = parseC2bPath(new URL(req.url).pathname);
    if (!path.ok) {
      // Deliberately do NOT log the path: it ends in <school_id>/<token>.
      console.error("fees-c2b-confirmation: malformed path, no valid school_id/token");
      return alwaysOk();
    }
    const { schoolId, token } = path;

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: config } = await serviceClient
      .from("mpesa_c2b_config")
      .select("school_id")
      .eq("school_id", schoolId)
      .eq("confirmation_token", token)
      .maybeSingle();

    if (!config) {
      console.error("fees-c2b-confirmation: school_id/token mismatch -- possible spoofed request", schoolId);
      void sendSecurityAlert("C2B confirmation rejected: school_id/token mismatch", {
        school_id: schoolId,
        source_ip: sourceCheck.sourceIp ?? "unknown",
      });
      return alwaysOk();
    }

    const { data: settings } = await serviceClient
      .from("mpesa_settings")
      .select("shortcode, environment, is_active")
      .eq("school_id", schoolId)
      .maybeSingle();

    if (!settings || !settings.is_active || !settings.shortcode) {
      console.error("fees-c2b-confirmation: school has no active M-Pesa settings", schoolId);
      void sendSecurityAlert("C2B confirmation rejected: school has no active M-Pesa settings", {
        school_id: schoolId,
        source_ip: sourceCheck.sourceIp ?? "unknown",
      });
      return alwaysOk();
    }

    // The enforcement flag is a sandbox convenience only. For any non-sandbox school the
    // Safaricom IP allowlist still applies even when MPESA_CALLBACK_IP_ALLOWLIST_ENFORCE=false.
    if (!sourceCheck.enforced && settings.environment !== "sandbox" && !sourceCheck.inAllowlist) {
      console.error(
        "fees-c2b-confirmation: allowlist enforcement is off but school is not sandbox -- rejecting request from",
        sourceCheck.sourceIp,
      );
      void sendSecurityAlert("C2B confirmation rejected: IP outside allowlist (non-sandbox school, enforcement flag ignored)", {
        school_id: schoolId,
        ip: sourceCheck.sourceIp ?? "unknown",
      });
      return alwaysOk();
    }

    // Cap the body before parsing: this endpoint is public, so never buffer an unbounded payload.
    const declaredLength = Number(req.headers.get("content-length") ?? "0");
    const rawBody = declaredLength > MAX_C2B_BODY_BYTES ? null : await req.text();
    if (rawBody === null || rawBody.length > MAX_C2B_BODY_BYTES) {
      console.error("fees-c2b-confirmation: body too large", schoolId);
      void sendSecurityAlert("C2B confirmation rejected: oversized body", {
        school_id: schoolId,
        source_ip: sourceCheck.sourceIp ?? "unknown",
      });
      return alwaysOk();
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      console.error("fees-c2b-confirmation: body is not valid JSON", schoolId);
      void sendSecurityAlert("C2B confirmation rejected: body is not valid JSON", {
        school_id: schoolId,
        source_ip: sourceCheck.sourceIp ?? "unknown",
      });
      return alwaysOk();
    }

    const parsed = parseC2bConfirmation(json);
    if (!parsed.ok) {
      // Never log the body itself: it carries the payer's details.
      console.error("fees-c2b-confirmation: rejected --", parsed.reason, parsed.transId ?? "");
      void sendSecurityAlert("C2B confirmation rejected: malformed payload", {
        school_id: schoolId,
        reason: parsed.reason,
        trans_id: parsed.transId ?? "unknown",
        source_ip: sourceCheck.sourceIp ?? "unknown",
      });
      return alwaysOk();
    }

    if (String(settings.shortcode).trim() !== parsed.shortcode) {
      console.error("fees-c2b-confirmation: BusinessShortCode does not match the school's shortcode", schoolId);
      void sendSecurityAlert("C2B confirmation rejected: shortcode does not match this school", {
        school_id: schoolId,
        trans_id: parsed.transId,
        source_ip: sourceCheck.sourceIp ?? "unknown",
      });
      return alwaysOk();
    }

    const { data, error } = await serviceClient.rpc("c2b_ingest_payment", {
      p_school_id: schoolId,
      p_provider: "mpesa_c2b",
      p_external_id: parsed.transId,
      p_amount: parsed.amount,
      p_account_reference: parsed.billRef,
      p_phone_masked: parsed.msisdnMasked,
      p_transaction_time: parsed.transTime,
    });

    if (error) {
      console.error("c2b_ingest_payment failed", error.message, parsed.transId);
      // Safaricom gets 200 regardless, so without this nothing would surface money that came in
      // but never reached the ledger.
      void sendSecurityAlert("C2B confirmation failed -- payment received but not recorded", {
        trans_id: parsed.transId,
        school_id: schoolId,
        error: error.message ?? "unknown",
      });
      return alwaysOk();
    }

    const outcome = (data as { outcome?: string } | null)?.outcome ?? "unknown";
    if (outcome === "failed") {
      void sendSecurityAlert("C2B confirmation recorded as FAILED -- needs attention", {
        trans_id: parsed.transId,
        school_id: schoolId,
      });
    }
    // No personal data in this line: TransID, outcome and school only.
    console.log("fees-c2b-confirmation: outcome", outcome, parsed.transId, schoolId);

    return alwaysOk();
  } catch (err) {
    console.error("fees-c2b-confirmation: unexpected error", err);
    void sendSecurityAlert("C2B confirmation: unexpected error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return alwaysOk();
  }
});
