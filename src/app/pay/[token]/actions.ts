"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRealClientIp } from "@/lib/get-real-client-ip";
import { dispatchInternalStkPush } from "@/lib/mpesa-internal-push";
import {
  hashPayLinkToken,
  isPayLinkToken,
  normalizeKenyanMsisdn,
  payLinkErrorMessage,
  PAY_LINK_UNAVAILABLE_MESSAGE,
} from "@/lib/pay-link";

// Public (unauthenticated) actions behind /pay/[token]. Every database call goes through
// service_role-only functions; the token is hashed here and never logged.
type StartResult = { ok: true; requestId: string } | { ok: false; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function startPayLinkPayment(token: string, phoneInput: string): Promise<StartResult> {
  if (!isPayLinkToken(token)) return { ok: false, message: PAY_LINK_UNAVAILABLE_MESSAGE };
  const phone = normalizeKenyanMsisdn(String(phoneInput ?? ""));
  if (!phone) return { ok: false, message: payLinkErrorMessage("INVALID_PHONE") };

  const ip = getRealClientIp((await headers()).get("x-forwarded-for"));
  const admin = createAdminClient();

  const { data: requestId, error } = await admin.rpc("pay_link_begin_payment", {
    p_token_hash: hashPayLinkToken(token),
    p_phone: phone,
    p_ip: ip,
  });
  if (error || typeof requestId !== "string") {
    return { ok: false, message: payLinkErrorMessage(error?.message) };
  }

  // mpesa-stk-push does the Daraja call, through its internal mode (WP 1.3b: x-dispatch-secret; the service key as a
  // Bearer token is rejected by the gateway). If this fails we deliberately do NOT mark the request failed: the push
  // may have reached Safaricom, and a resolved row would make the callback ignore a real payment. A row left pending
  // is reconciled by the stale-pending watchdog.
  const pushed = await dispatchInternalStkPush(requestId);
  if (!pushed.ok) {
    console.error("pay-link: internal STK push failed", pushed.reason, pushed.status ?? "");
    return { ok: false, message: "We could not send the M-Pesa prompt. Please wait two minutes and try again." };
  }
  return { ok: true, requestId };
}

export async function getPayLinkStatus(
  token: string,
  requestId: string,
): Promise<{ status: "pending" | "completed" | "failed" | "cancelled" | "unknown" }> {
  if (!isPayLinkToken(token) || !UUID_RE.test(requestId)) return { status: "unknown" };
  const { data, error } = await createAdminClient().rpc("pay_link_attempt_status", {
    p_token_hash: hashPayLinkToken(token),
    p_request_id: requestId,
  });
  if (error || typeof data !== "string") return { status: "unknown" };
  return { status: (["pending", "completed", "failed", "cancelled"].includes(data) ? data : "unknown") as never };
}
