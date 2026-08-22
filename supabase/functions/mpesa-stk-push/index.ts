import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  getDarajaOAuthToken,
  initiateDarajaStkPush,
  normalizeKenyanPhoneForDaraja,
} from "../_shared/mpesa/daraja.ts";

// Called from an authenticated Next.js server action (src/app/(app)/integrations/actions.ts)
// right after initiate_mpesa_stk_request() has already created the pending row -- that DB
// function is where the real authorization (finance.write, student-in-school, invoice
// ownership, rate limit) happens. This function's own job is narrower: re-verify the caller
// can actually see this specific request (via RLS, under their own JWT -- not just "a valid
// UUID was supplied"), then make the real Daraja HTTP calls a database function can't make.
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

    const { request_id } = await req.json();
    if (typeof request_id !== "string") {
      return json({ error: "request_id is required." }, 400);
    }

    // User-scoped client: the read below is RLS-gated (finance.read + same school), so a
    // caller who isn't actually authorized to see this school's finance data gets nothing back
    // here regardless of whether they know the request_id -- this is the real cross-tenant
    // guard, not just "the id happened to be hard to guess".
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: request, error: requestError } = await userClient
      .from("mpesa_stk_requests")
      .select("id, school_id, amount, phone_number, status, checkout_request_id")
      .eq("id", request_id)
      .maybeSingle();

    if (requestError || !request) {
      return json({ error: "STK request not found or not visible to you." }, 404);
    }
    if (request.status !== "pending" || request.checkout_request_id) {
      return json({ error: "This request has already been dispatched or resolved." }, 409);
    }

    const normalizedPhone = normalizeKenyanPhoneForDaraja(request.phone_number);
    if (!normalizedPhone) {
      return json({ error: "Stored phone number is not a valid Kenyan number." }, 422);
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [{ data: settings }, { data: credsRow }] = await Promise.all([
      serviceClient
        .from("mpesa_settings")
        .select("shortcode, shortcode_type, environment, is_active, callback_token")
        .eq("school_id", request.school_id)
        .maybeSingle(),
      serviceClient
        .from("mpesa_credentials")
        .select("consumer_key, consumer_secret, passkey")
        .eq("school_id", request.school_id)
        .maybeSingle(),
    ]);

    if (!settings || !settings.is_active || !credsRow || !settings.shortcode) {
      return json({ error: "M-Pesa is not configured for this school." }, 422);
    }

    const creds = {
      shortcode: settings.shortcode,
      consumerKey: credsRow.consumer_key,
      consumerSecret: credsRow.consumer_secret,
      passkey: credsRow.passkey,
      environment: settings.environment as "sandbox" | "production",
    };

    const callbackUrl =
      `${Deno.env.get("SUPABASE_URL")!}/functions/v1/mpesa-stk-callback` +
      `/${request.school_id}/${settings.callback_token}`;

    try {
      const accessToken = await getDarajaOAuthToken(creds);
      const result = await initiateDarajaStkPush({
        creds,
        accessToken,
        amount: request.amount,
        phoneNumber: normalizedPhone,
        accountReference: request.id.slice(0, 12),
        transactionDesc: "School fees",
        callbackUrl,
        transactionType:
          settings.shortcode_type === "till" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
      });

      const { error: dispatchError } = await serviceClient.rpc("mpesa_stk_request_dispatched", {
        p_request_id: request.id,
        p_checkout_request_id: result.checkoutRequestId,
        p_merchant_request_id: result.merchantRequestId,
      });
      if (dispatchError) {
        console.error("mpesa_stk_request_dispatched failed after a real Daraja push went out", dispatchError);
        return json({ error: "Push sent but failed to record locally -- contact support." }, 500);
      }

      return json({ success: true, request_id: request.id });
    } catch (darajaError) {
      console.error("Daraja STK push failed", darajaError);
      await serviceClient.rpc("mpesa_stk_dispatch_failed", {
        p_request_id: request.id,
        p_reason: darajaError instanceof Error ? darajaError.message : "Unknown Daraja error",
      });
      return json({ error: "Could not reach M-Pesa. Please try again." }, 502);
    }
  } catch (err) {
    console.error(err);
    return json({ error: "Unexpected error." }, 500);
  }
});
