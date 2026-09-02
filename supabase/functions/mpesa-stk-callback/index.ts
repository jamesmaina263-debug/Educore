import { createClient } from "jsr:@supabase/supabase-js@2";
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
      console.error("mpesa-stk-callback: malformed path, no school_id/token", url.pathname);
      return alwaysOk();
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: settings } = await serviceClient
      .from("mpesa_settings")
      .select("school_id")
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
    });

    if (error) {
      console.error("mpesa_stk_callback_confirm failed", error, stkCallback.CheckoutRequestID);
    }

    return alwaysOk();
  } catch (err) {
    console.error("mpesa-stk-callback: unexpected error", err);
    return alwaysOk();
  }
});
