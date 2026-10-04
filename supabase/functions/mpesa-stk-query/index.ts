import { createClient } from "jsr:@supabase/supabase-js@2.112.4";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { sendSecurityAlert } from "../_shared/securityAlert.ts";
import { timingSafeEqual } from "../_shared/timingSafeEqual.ts";
import { getDarajaOAuthToken, queryDarajaStkStatus } from "../_shared/mpesa/daraja.ts";
import { interpretStkQueryResponse } from "../_shared/mpesa/stkQueryResult.ts";

// Fallback for a lost Daraja callback. Safaricom's callback to mpesa-stk-callback is the only
// thing that moves an STK request out of 'pending', and it is not always delivered (see
// _shared/mpesa/stkQueryResult.ts for the 2026-10-04 incident). This function asks Safaricom
// directly (STK Push Query) and, only when the answer is FINAL, feeds it through the very same
// mpesa_stk_callback_confirm() RPC the callback uses.
//
// Why this cannot collide with the real callback:
//   * mpesa_stk_callback_confirm() is idempotent: it returns early unless the request is still
//     'pending', serialises payment writes per student with an advisory lock, and treats a
//     concurrent duplicate insert (unique payments.mpesa_checkout_request_id) as "already won".
//     Callback and query can therefore both fire at once and exactly one payment is recorded.
//   * Daraja is only asked about 'pending', dispatched requests that are 30s-24h old, and each
//     request is claimed atomically via last_query_at (20s throttle) so concurrent pollers and the
//     cron never double-query Safaricom (which also rate-limits: spike arrest 30/min, burst 3).
//   * A non-final answer (still processing, Daraja error, 429, network failure) changes nothing.
//
// Known limitation: the STK Query API returns no M-Pesa receipt number or amount, so a payment
// confirmed through this path is stored with reference = NULL (the unique index ignores NULL) and
// the amount we requested. A callback that arrives later finds the request already resolved.
//
// Callers:
//   * user mode  -- Next.js server action getMpesaRequestStatus() with the user's JWT; the request
//     must be visible to the caller under RLS (same cross-tenant guard as mpesa-stk-push).
//   * batch mode -- /api/cron/mpesa-stale-pending with the service-role key, for requests nobody
//     is watching any more.
const MIN_AGE_MS = 30_000; // give the genuine callback (normally 12-16s after the PIN) a head start
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const THROTTLE_MS = 20_000;
const MAX_BATCH = 5;
const BATCH_SPACING_MS = 2_000; // Daraja spike arrest: burst 3, 30 messages/min

type ReconcileOutcome =
  | "resolved"
  | "processing"
  | "throttled"
  | "too_new"
  | "too_old"
  | "not_pending"
  | "not_configured"
  | "error";

interface ReconcileResult {
  request_id: string;
  status: string | null;
  outcome: ReconcileOutcome;
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const isServiceCaller = serviceKey.length > 0 && timingSafeEqual(bearer, serviceKey);

    const body = await req.json().catch(() => ({}));

    // ---- batch mode (cron, service role only) -------------------------------------------
    if (isServiceCaller) {
      const ids: string[] = Array.isArray(body?.request_ids)
        ? body.request_ids.filter((x: unknown): x is string => typeof x === "string")
        : typeof body?.request_id === "string"
          ? [body.request_id]
          : [];
      if (ids.length === 0) {
        return json({ error: "request_ids is required." }, 400);
      }
      const results: ReconcileResult[] = [];
      const tokenCache = new Map<string, string>();
      let daraja_calls = 0;
      for (const id of ids.slice(0, MAX_BATCH)) {
        if (daraja_calls > 0) await new Promise((r) => setTimeout(r, BATCH_SPACING_MS));
        const result = await reconcileOne(serviceClient, id, tokenCache);
        if (result.outcome === "resolved" || result.outcome === "processing" || result.outcome === "error") {
          daraja_calls += 1;
        }
        results.push(result);
      }
      return json({ success: true, results });
    }

    // ---- user mode ----------------------------------------------------------------------
    const requestId = body?.request_id;
    if (typeof requestId !== "string") {
      return json({ error: "request_id is required." }, 400);
    }

    // RLS-gated read under the caller's own JWT: a caller who cannot see this school's finance
    // data gets nothing back whether or not they know the request_id.
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: visible, error: visibleError } = await userClient
      .from("mpesa_stk_requests")
      .select("id")
      .eq("id", requestId)
      .maybeSingle();
    if (visibleError || !visible) {
      return json({ error: "STK request not found or not visible to you." }, 404);
    }

    const result = await reconcileOne(serviceClient, requestId, new Map());
    return json({ success: true, status: result.status, outcome: result.outcome });
  } catch (err) {
    console.error("mpesa-stk-query: unexpected error", err);
    return json({ error: "Unexpected error." }, 500);
  }
});

async function reconcileOne(
  serviceClient: ReturnType<typeof createClient>,
  requestId: string,
  tokenCache: Map<string, string>,
): Promise<ReconcileResult> {
  const fail = (status: string | null, outcome: ReconcileOutcome): ReconcileResult => ({
    request_id: requestId,
    status,
    outcome,
  });

  const { data: row, error: rowError } = await serviceClient
    .from("mpesa_stk_requests")
    .select("id, school_id, status, checkout_request_id, initiated_at")
    .eq("id", requestId)
    .maybeSingle();
  if (rowError || !row) return fail(null, "error");
  if (row.status !== "pending" || !row.checkout_request_id) return fail(row.status, "not_pending");

  const ageMs = Date.now() - new Date(row.initiated_at).getTime();
  if (ageMs < MIN_AGE_MS) return fail("pending", "too_new");
  if (ageMs > MAX_AGE_MS) return fail("pending", "too_old");

  // Atomic claim (same pattern as mpesa-stk-push's dispatch claim): only one concurrent caller
  // gets to ask Daraja about this request per throttle window.
  const { data: claimed, error: claimError } = await serviceClient
    .from("mpesa_stk_requests")
    .update({ last_query_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "pending")
    .not("checkout_request_id", "is", null)
    .or(`last_query_at.is.null,last_query_at.lt.${new Date(Date.now() - THROTTLE_MS).toISOString()}`)
    .select("id")
    .maybeSingle();
  if (claimError) {
    console.error("mpesa-stk-query: claim failed", claimError);
    return fail("pending", "error");
  }
  if (!claimed) return fail("pending", "throttled");

  const [{ data: settings }, { data: credsRows, error: credsError }] = await Promise.all([
    serviceClient
      .from("mpesa_settings")
      .select("shortcode, environment")
      .eq("school_id", row.school_id)
      .maybeSingle(),
    serviceClient.rpc("get_mpesa_credentials_decrypted", { p_school_id: row.school_id }),
  ]);
  const credsRow = credsRows?.[0];
  if (
    !settings || !settings.shortcode || credsError || !credsRow ||
    !credsRow.consumer_key || !credsRow.consumer_secret || !credsRow.passkey
  ) {
    if (credsError) console.error("mpesa-stk-query: get_mpesa_credentials_decrypted failed", credsError);
    return fail("pending", "not_configured");
  }

  const creds = {
    shortcode: settings.shortcode as string,
    consumerKey: credsRow.consumer_key as string,
    consumerSecret: credsRow.consumer_secret as string,
    passkey: credsRow.passkey as string,
    environment: settings.environment as "sandbox" | "production",
  };

  let outcome;
  try {
    let accessToken = tokenCache.get(row.school_id);
    if (!accessToken) {
      accessToken = await getDarajaOAuthToken(creds);
      tokenCache.set(row.school_id, accessToken);
    }
    const raw = await queryDarajaStkStatus({
      creds,
      accessToken,
      checkoutRequestId: row.checkout_request_id,
    });
    outcome = interpretStkQueryResponse(raw.httpStatus, raw.body);
  } catch (e) {
    // Network failure / timeout: not a final answer, leave the request untouched.
    console.error("mpesa-stk-query: Daraja call failed", e instanceof Error ? e.message : e);
    return fail("pending", "error");
  }

  if (outcome.kind === "processing") return fail("pending", "processing");

  const { error: confirmError } = await serviceClient.rpc("mpesa_stk_callback_confirm", {
    p_checkout_request_id: row.checkout_request_id,
    p_result_code: outcome.resultCode,
    p_result_desc:
      outcome.resultDesc ||
      (outcome.kind === "success" ? "Confirmed via STK Query." : "Failed (reported by STK Query)."),
    p_receipt_number: null,
    p_amount: null,
    p_phone_number: null,
    // Same school binding the callback path uses -- the RPC refuses a request from another school.
    p_school_id: row.school_id,
  });

  if (confirmError) {
    console.error("mpesa-stk-query: mpesa_stk_callback_confirm failed", confirmError, row.checkout_request_id);
    void sendSecurityAlert("M-Pesa STK query confirm failed -- Safaricom reported a result but it was not recorded", {
      checkout_request_id: row.checkout_request_id,
      school_id: row.school_id,
      result_code: String(outcome.resultCode),
      error: confirmError.message ?? "unknown",
    });
    return fail("pending", "error");
  }

  const { data: after } = await serviceClient
    .from("mpesa_stk_requests")
    .select("status")
    .eq("id", row.id)
    .maybeSingle();
  return { request_id: requestId, status: after?.status ?? null, outcome: "resolved" };
}
