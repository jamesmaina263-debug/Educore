// Pure interpretation of a Daraja STK Push Query response (POST /mpesa/stkpushquery/v1/query),
// kept free of Deno globals so it is unit-testable under vitest.
//
// Why this exists: Safaricom's callback to /mpesa-stk-callback is the only thing that moves an
// STK request out of 'pending', and Safaricom does not always deliver it (sandbox especially).
// On 2026-10-04 three pushes were accepted by Daraja, the STK Query API reported two of them as
// paid (ResultCode 0) and one as failed (2001), and the callback endpoint received zero requests,
// so all three sat on "Awaiting response". The STK Query API is the documented way to ask
// Safaricom for the outcome of a CheckoutRequestID instead of waiting for the callback.
//
// The query answers with a *final* ResultCode (0 = paid; 1032 = cancelled; 1037 = timed out;
// 2001 = wrong PIN; 1 = insufficient funds; ...), or with something that means "not decided yet":
//   - ResultCode 4999 ("still under processing"), or
//   - a non-200 error (e.g. errorCode 500.001.1001 "The transaction is being processed"), or
//   - 429 spike arrest, or no ResultCode at all.
// Anything not definitely final MUST leave the request 'pending' -- never mark a payment failed
// because Daraja was busy.

export type StkQueryOutcome =
  | { kind: "success"; resultCode: 0; resultDesc: string }
  | { kind: "failed"; resultCode: number; resultDesc: string }
  | { kind: "processing" };

const STILL_PROCESSING_RESULT_CODES = new Set([4999]);

export function interpretStkQueryResponse(httpStatus: number, body: unknown): StkQueryOutcome {
  if (httpStatus !== 200 || typeof body !== "object" || body === null) {
    return { kind: "processing" };
  }
  const b = body as Record<string, unknown>;
  const raw = b.ResultCode;
  if (raw === undefined || raw === null || raw === "") return { kind: "processing" };

  const code = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isInteger(code)) return { kind: "processing" };
  if (STILL_PROCESSING_RESULT_CODES.has(code)) return { kind: "processing" };

  const resultDesc = typeof b.ResultDesc === "string" ? b.ResultDesc : "";
  if (code === 0) return { kind: "success", resultCode: 0, resultDesc };
  return { kind: "failed", resultCode: code, resultDesc };
}
