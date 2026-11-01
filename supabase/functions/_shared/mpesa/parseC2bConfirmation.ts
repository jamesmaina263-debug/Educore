// Strict parsing for the Daraja C2B (paybill) confirmation that fees-c2b-confirmation receives.
//
// Kept free of Deno/Supabase imports so it can be unit-tested with vitest (see
// src/lib/mpesa-parse-c2b-confirmation.test.ts).
//
// What this guards: the confirmation body is attacker-reachable (the URL secret and Safaricom IP
// allowlist are the only other layers), and c2b_ingest_payment() trusts the amount and TransID it
// is handed. So nothing reaches the database unless it is a well-formed, positive, bounded
// payment. Personal data is never carried further than needed: the payer's name fields are
// ignored entirely and the phone number is reduced to a masked form here, before anything is
// stored or logged.

export const MAX_C2B_BODY_BYTES = 16 * 1024;
// Sanity ceiling only. M-Pesa's own per-transaction limit is far lower; this just stops an absurd
// forged amount reaching the ledger.
export const MAX_C2B_AMOUNT = 10_000_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// c2b token is encode(gen_random_bytes(24), 'hex'): exactly 48 lowercase hex characters.
const TOKEN_RE = /^[0-9a-f]{48}$/;
// M-Pesa TransIDs are short alphanumeric codes (e.g. "RKTQDM7W6S"). Deliberately lenient on length
// so a format change cannot silently stop real payments from being recorded.
const TRANS_ID_RE = /^[A-Za-z0-9]{6,20}$/;
const SHORTCODE_RE = /^[0-9]{4,10}$/;
const AMOUNT_RE = /^[0-9]+(\.[0-9]{1,2})?$/;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/g;

export type ParsedC2bPath = { ok: true; schoolId: string; token: string } | { ok: false };

// Path shape: .../fees-c2b-confirmation/<school_id>/<confirmation_token>
export function parseC2bPath(pathname: string): ParsedC2bPath {
  const parts = pathname.split("/").filter(Boolean);
  const schoolId = parts.at(-2);
  const token = parts.at(-1);
  if (!schoolId || !token || !UUID_RE.test(schoolId) || !TOKEN_RE.test(token)) return { ok: false };
  return { ok: true, schoolId: schoolId.toLowerCase(), token };
}

// Daraja v2 already masks the phone number ("2547*****126"). Anything else is reduced to the same
// shape here; a hashed value (v1) or something unrecognisable is dropped.
export function maskMsisdn(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim();
  if (s === "" || /^[0-9a-f]{64}$/i.test(s)) return null;
  const digits = s.replace(/\D/g, "");
  if (s.includes("*")) {
    return digits.length <= 9 ? s.replace(/\s+/g, "").slice(0, 30) : null;
  }
  if (digits.length >= 10) return digits.slice(0, 4) + "*****" + digits.slice(-3);
  return null;
}

// Daraja's TransTime is yyyyMMddHHmmss in East Africa Time (UTC+3).
export function parseTransTime(raw: unknown): string | null {
  const s = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+03:00`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

export type ParsedC2bConfirmation =
  | {
      ok: true;
      transId: string;
      amount: number;
      shortcode: string;
      billRef: string | null;
      msisdnMasked: string | null;
      transTime: string | null;
      transactionType: string | null;
    }
  | { ok: false; reason: string; transId: string | null };

export function parseC2bConfirmation(body: unknown): ParsedC2bConfirmation {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "body is not a JSON object", transId: null };
  }
  const b = body as Record<string, unknown>;

  const rawId = b.TransID;
  const transId = typeof rawId === "string" && TRANS_ID_RE.test(rawId.trim()) ? rawId.trim().toUpperCase() : null;
  if (transId === null) {
    return { ok: false, reason: "missing or invalid TransID", transId: null };
  }

  const rawAmount = b.TransAmount;
  let amount: number | null = null;
  if (typeof rawAmount === "number" && Number.isFinite(rawAmount)) amount = rawAmount;
  else if (typeof rawAmount === "string" && AMOUNT_RE.test(rawAmount.trim())) amount = Number(rawAmount.trim());
  if (amount === null || amount <= 0 || amount > MAX_C2B_AMOUNT) {
    return { ok: false, reason: "missing, non-positive or out-of-range TransAmount", transId };
  }
  amount = Math.round(amount * 100) / 100;

  const rawShortcode = b.BusinessShortCode;
  const shortcode =
    (typeof rawShortcode === "string" || typeof rawShortcode === "number") && SHORTCODE_RE.test(String(rawShortcode).trim())
      ? String(rawShortcode).trim()
      : null;
  if (shortcode === null) {
    return { ok: false, reason: "missing or invalid BusinessShortCode", transId };
  }

  const rawBill = b.BillRefNumber;
  const billClean =
    typeof rawBill === "string" || typeof rawBill === "number"
      ? String(rawBill).replace(CONTROL_CHARS_RE, "").trim().slice(0, 100)
      : "";
  const rawType = b.TransactionType;
  const transactionType =
    typeof rawType === "string" ? rawType.replace(CONTROL_CHARS_RE, "").trim().slice(0, 30) || null : null;

  return {
    ok: true,
    transId,
    amount,
    shortcode,
    billRef: billClean === "" ? null : billClean,
    msisdnMasked: maskMsisdn(b.MSISDN),
    transTime: parseTransTime(b.TransTime),
    transactionType,
  };
}
