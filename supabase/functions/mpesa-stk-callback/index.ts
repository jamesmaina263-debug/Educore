import { createClient } from "jsr:@supabase/supabase-js@2.112.4";
import { verifyCallbackSource } from "../_shared/mpesa/verifyCallbackSource.ts";
import { sendSecurityAlert } from "../_shared/securityAlert.ts";

// Public webhook Safaricom calls directly -- no Supabase session, so this function must be
// deployed with verify_jwt disabled (`supabase functions deploy mpesa-stk-callback --no-verify-jwt`).
// Daraja callbacks carry no custom headers/auth we control, so the URL path itself
// (/mpesa-stk-callback/<school_id>/<callback_token>) is the shared secret -- callback_token is
// a random 24-byte value generated per school in mpesa_settings, never displayed in the UI.
// verifyCallbackSource() adds a second, independent layer on top of that (Safaricom's published
// callback source IPs) -- see that file for why this exists instead of a Twilio-style HMAC
// signature check, which Daraja doesn't support.
//
// Per Daraja's own documented behavior, Safaricom retries a callback that doesn't get a 200
// response -- so this function ALWAYS returns 200 with {ResultCode: 0}, even when our own
// processing fails internally (including a rejected source-IP or token check below). A non-200
// here just causes pointless retries; real failures are logged (console.error) instead, and
// mpesa_stk_callback_confirm() is itself idempotent (matches Safaricom's own retry behavior on
// the legitimate-duplicate-delivery case).

interface StkCallbackItem {
  Name: string;
  Value?: string | number;
}

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
        "mpesa-stk-callback: IP allowlist enforcement is DISABLED (MPESA_CALLBACK_IP_ALLOWLIST_ENFORCE=false) -- accepting from",
        sourceCheck.sourceIp,
      );
    } else if (!sourceCheck.allowed) {
      console.error(
        "mpesa-stk-callback: rejected callback from IP outside Safaricom's allowlist",
        sourceCheck.sourceIp,
      );
      // DIAGNOSTIC (temporary): record the raw network-identity headers so we can tell whether
      // the rejected IP is the real Daraja egress or an intermediary hop picked up as the last
      // X-Forwarded-For entry. Deliberately excludes the URL path (it contains the callback
      // token) and the request body. Remove once the allowlist question is settled.
      console.error(
        "mpesa-stk-callback: DIAG source headers",
        JSON.stringify({
          xff: req.headers.get("x-forwarded-for"),
          cfConnectingIp: req.headers.get("cf-connecting-ip"),
          xRealIp: req.headers.get("x-real-ip"),
          forwarded: req.headers.get("forwarded"),
          userAgent: req.headers.get("user-agent"),
        }),
      );
      void sendSecurityAlert("M-Pesa callback rejected: IP outside Safaricom allowlist", {
        ip: sourceCheck.sourceIp ?? "unknown",
      });
      return alwaysOk();
    }

    const url = new URL(req.url);
    // Path shape: /mpesa-stk-callback/<school_id>/<callback_token>
    const parts = url.pathname.split("/").filter(Boolean);
    const schoolId = parts.at(-2);
    const callbackToken = parts.at(-1);

    if (!schoolId || !callbackToken) {
      // Deliberately do NOT log url.pathname: it ends in <school_id>/<callback_token>.
      console.error("mpesa-stk-callback: malformed path, no school_id/token");
      return alwaysOk();
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: settings } = await serviceClient
      .from("mpesa_settings")
      .select("school_id, environment")
      .eq("school_id", schoolId)
      .eq("callback_token", callbackToken)
      .maybeSingle();

    if (!settings) {
      console.error("mpesa-stk-callback: school_id/token mismatch -- possible spoofed callback", schoolId);
      void sendSecurityAlert("M-Pesa callback rejected: school_id/token mismatch", {
        school_id: schoolId,
        source_ip: sourceCheck.sourceIp ?? "unknown",
      });
      return alwaysOk();
    }

    // The enforcement flag is a sandbox convenience only. For any non-sandbox school the
    // Safaricom IP allowlist still applies even when MPESA_CALLBACK_IP_ALLOWLIST_ENFORCE=false.
    if (!sourceCheck.enforced && settings.environment !== "sandbox" && !sourceCheck.inAllowlist) {
      console.error(
        "mpesa-stk-callback: allowlist enforcement is off but school is not sandbox -- rejecting callback from",
        sourceCheck.sourceIp,
      );
      void sendSecurityAlert("M-Pesa callback rejected: IP outside allowlist (non-sandbox school, enforcement flag ignored)", {
        school_id: schoolId,
        ip: sourceCheck.sourceIp ?? "unknown",
      });
      return alwaysOk();
    }

    const body = await req.json();
    const stkCallback = body?.Body?.stkCallback;
    if (!stkCallback?.CheckoutRequestID) {
      console.error("mpesa-stk-callback: missing Body.stkCallback.CheckoutRequestID", JSON.stringify(body));
      return alwaysOk();
    }

    const resultCode: number = stkCallback.ResultCode;
    const resultDesc: string = stkCallback.ResultDesc ?? "";
    const items: StkCallbackItem[] = stkCallback.CallbackMetadata?.Item ?? [];
    const getItem = (name: string) => items.find((i) => i.Name === name)?.Value;

    const amount = getItem("Amount");
    const receiptNumber = getItem("MpesaReceiptNumber");
    const phoneNumber = getItem("PhoneNumber");

    const { error } = await serviceClient.rpc("mpesa_stk_callback_confirm", {
      p_checkout_request_id: stkCallback.CheckoutRequestID,
      p_result_code: resultCode,
      p_result_desc: resultDesc,
      p_receipt_number: typeof receiptNumber === "string" ? receiptNumber : null,
      p_amount: typeof amount === "number" ? amount : null,
      p_phone_number: phoneNumber != null ? String(phoneNumber) : null,
      // Bind the callback to the school whose token was validated above.
      p_school_id: schoolId,
    });

    if (error) {
      console.error("mpesa_stk_callback_confirm failed", error, stkCallback.CheckoutRequestID);
      // Safaricom always gets 200 below regardless of this outcome (see the top-of-file note),
      // so an RPC failure here has zero visibility otherwise -- Safaricom won't retry it (it
      // already got its 200 on a prior or this attempt) and nothing else surfaces the money
      // that came in but never got reconciled against an invoice.
      void sendSecurityAlert("M-Pesa callback confirm failed -- payment received but not recorded", {
        checkout_request_id: stkCallback.CheckoutRequestID,
        school_id: schoolId,
        error: error.message ?? "unknown",
      });
    }

    if (!error && resultCode === 0) {
      // mpesa_stk_callback_confirm refuses to record a success whose Amount differs from the
      // requested amount: it leaves the request 'pending' tagged AMOUNT_MISMATCH. Surface it.
      const { data: after } = await serviceClient
        .from("mpesa_stk_requests")
        .select("status, result_desc")
        .eq("checkout_request_id", stkCallback.CheckoutRequestID)
        .maybeSingle();
      if (after?.status === "pending" && after.result_desc?.startsWith("AMOUNT_MISMATCH")) {
        void sendSecurityAlert("M-Pesa callback amount mismatch -- payment NOT recorded", {
          checkout_request_id: stkCallback.CheckoutRequestID,
          school_id: schoolId,
          detail: after.result_desc,
          source_ip: sourceCheck.sourceIp ?? "unknown",
        });
      }
    }

    return alwaysOk();
  } catch (err) {
    console.error("mpesa-stk-callback: unexpected error", err);
    void sendSecurityAlert("M-Pesa callback: unexpected error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return alwaysOk();
  }
});
