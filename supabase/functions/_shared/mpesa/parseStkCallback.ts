// Strict validation of the body Safaricom POSTs to mpesa-stk-callback.
//
// Kept free of Deno/Supabase imports so it can be unit-tested with vitest (see
// src/lib/mpesa-parse-stk-callback.test.ts).
//
// Why this exists (security audit finding H2, hardening): callback authenticity rests on the
// URL token + Safaricom IP allowlist, and mpesa_stk_callback_confirm() trusts the amount and
// receipt it is handed. A genuine Daraja SUCCESS callback always carries both Amount and
// MpesaReceiptNumber. A "success" without them is either an API change we need to know about or
// a forged request, and in neither case should it be turned into a recorded payment from the
// callback path. Rejecting it leaves the request 'pending', where the STK Query reconciliation
// (mpesa-stk-query, run by /api/cron/mpesa-stale-pending) resolves it against Daraja itself.

export const MAX_CALLBACK_BODY_BYTES = 16 * 1024;

export interface StkCallbackItem {
  Name: string;
  Value?: string | number;
}

export type ParsedStkCallback =
  | {
      ok: true;
      checkoutRequestId: string;
      resultCode: number;
      resultDesc: string;
      amount: number | null;
      receiptNumber: string | null;
      phoneNumber: string | null;
    }
  | { ok: false; reason: string; checkoutRequestId: string | null; isSuccessCode: boolean };

// M-Pesa receipt numbers are short alphanumeric codes (e.g. "NLJ7RT61SV"). Deliberately lenient on
// length so a Safaricom format change cannot silently stop real payments from being recorded.
const RECEIPT_PATTERN = /^[A-Za-z0-9]{6,20}$/;

export function parseStkCallback(body: unknown): ParsedStkCallback {
  const stk = (body as { Body?: { stkCallback?: Record<string, unknown> } } | null)?.Body?.stkCallback;
  const rawId = stk?.CheckoutRequestID;
  const checkoutRequestId =
    typeof rawId === "string" && rawId.length > 0 && rawId.length <= 100 ? rawId : null;

  if (!stk || checkoutRequestId === null) {
    return { ok: false, reason: "missing or invalid CheckoutRequestID", checkoutRequestId, isSuccessCode: false };
  }

  const resultCode = stk.ResultCode;
  if (typeof resultCode !== "number" || !Number.isInteger(resultCode)) {
    return { ok: false, reason: "ResultCode is not an integer", checkoutRequestId, isSuccessCode: false };
  }

  const resultDesc = typeof stk.ResultDesc === "string" ? stk.ResultDesc.slice(0, 500) : "";
  const metadata = (stk.CallbackMetadata as { Item?: unknown } | undefined)?.Item;
  const items: StkCallbackItem[] = Array.isArray(metadata) ? (metadata as StkCallbackItem[]) : [];
  const getItem = (name: string) => items.find((i) => i?.Name === name)?.Value;

  const amountRaw = getItem("Amount");
  const receiptRaw = getItem("MpesaReceiptNumber");
  const phoneRaw = getItem("PhoneNumber");

  const amount = typeof amountRaw === "number" && Number.isFinite(amountRaw) ? amountRaw : null;
  const receiptNumber = typeof receiptRaw === "string" && RECEIPT_PATTERN.test(receiptRaw) ? receiptRaw : null;
  const phoneNumber = phoneRaw != null ? String(phoneRaw).slice(0, 20) : null;

  if (resultCode === 0 && (amount === null || amount <= 0 || receiptNumber === null)) {
    return {
      ok: false,
      reason: "success callback without a valid Amount and MpesaReceiptNumber",
      checkoutRequestId,
      isSuccessCode: true,
    };
  }

  return { ok: true, checkoutRequestId, resultCode, resultDesc, amount, receiptNumber, phoneNumber };
}
