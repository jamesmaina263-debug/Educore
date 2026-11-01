import { createClient } from "jsr:@supabase/supabase-js@2.112.4";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { getDarajaOAuthToken } from "../_shared/mpesa/daraja.ts";
import {
  buildC2bConfirmationUrl,
  buildC2bRegisterRequest,
  c2bRegisterEndpoint,
  C2B_FLAG_KEY,
  checkRegistrationPreconditions,
  interpretC2bRegisterResponse,
  redactToken,
} from "../_shared/mpesa/c2bRegistration.ts";

// Registers a school's C2B confirmation URL with Daraja. SANDBOX ONLY in this version.
//
// Caller must be a platform super_admin with a real user JWT (the service role is not accepted),
// the same gate as send-owner-campaign. Body: { school_id }. Nothing school-facing calls this.
//
// It refuses unless the school has feature.finance.c2b_capture on, an active shortcode, saved Daraja
// credentials, and environment = sandbox. It creates the mpesa_c2b_config row if absent (mode stays
// 'log_only'), calls Register URL v2, and sets registered_at only on success. The confirmation
// token is never returned, logged, or written to the audit entry; Daraja error text is scrubbed
// of it first. Every attempt (success or failure) writes one audit_log entry.
Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  let token = "";
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Not signed in." }, 401);

    const { data: isSuperAdmin } = await userClient.rpc("auth_is_super_admin");
    if (isSuperAdmin !== true) return json({ error: "Only a platform super admin can register C2B URLs." }, 403);

    const payload = await req.json().catch(() => ({}));
    const schoolId = typeof payload.school_id === "string" ? payload.school_id.toLowerCase() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(schoolId)) {
      return json({ error: "school_id (UUID) is required." }, 400);
    }

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const [{ data: flagEnabled }, { data: settings }, { data: credsRows, error: credsError }] = await Promise.all([
      admin.rpc("school_has_feature_flag", { p_school_id: schoolId, p_key: C2B_FLAG_KEY }),
      admin.from("mpesa_settings").select("shortcode, is_active, environment, shortcode_type").eq("school_id", schoolId).maybeSingle(),
      admin.rpc("get_mpesa_credentials_decrypted", { p_school_id: schoolId }),
    ]);
    const credsRow = credsRows?.[0];
    if (credsError) console.error("c2b-register-url: get_mpesa_credentials_decrypted failed");

    const pre = checkRegistrationPreconditions({
      flagEnabled: flagEnabled === true,
      settings: settings ?? null,
      hasCredentials: !!(credsRow && credsRow.consumer_key && credsRow.consumer_secret),
    });
    if (!pre.ok) return json({ error: pre.message, code: pre.code }, 422);

    // Create the config row if absent (token and mode come from column defaults), then read the
    // token server-side only. ignoreDuplicates keeps an existing row, and its token, untouched.
    const { error: insertErr } = await admin
      .from("mpesa_c2b_config")
      .upsert({ school_id: schoolId }, { onConflict: "school_id", ignoreDuplicates: true });
    if (insertErr) {
      console.error("c2b-register-url: could not create config row", insertErr.code);
      return json({ error: "Could not create the C2B config row." }, 500);
    }
    const { data: config, error: configErr } = await admin
      .from("mpesa_c2b_config")
      .select("confirmation_token")
      .eq("school_id", schoolId)
      .maybeSingle();
    if (configErr || !config?.confirmation_token) {
      return json({ error: "Could not read the C2B config row." }, 500);
    }
    token = config.confirmation_token as string;

    const shortcode = String(settings!.shortcode).trim();
    const confirmationUrl = buildC2bConfirmationUrl({ supabaseUrl, schoolId, token });
    const request = buildC2bRegisterRequest({ shortcode, confirmationUrl });

    let outcome: ReturnType<typeof interpretC2bRegisterResponse>;
    try {
      const accessToken = await getDarajaOAuthToken({
        shortcode,
        consumerKey: credsRow.consumer_key,
        consumerSecret: credsRow.consumer_secret,
        passkey: credsRow.passkey ?? "",
        environment: "sandbox",
      });
      const res = await fetch(c2bRegisterEndpoint("sandbox"), {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify(request),
      });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      outcome = interpretC2bRegisterResponse(res.status, body);
    } catch (e) {
      outcome = { ok: false, reason: e instanceof Error ? e.message : "Daraja request failed" };
    }

    const reason = outcome.ok ? null : redactToken(outcome.reason, token).slice(0, 200);

    if (outcome.ok) {
      const { error: updErr } = await admin
        .from("mpesa_c2b_config")
        .update({ registered_at: new Date().toISOString() })
        .eq("school_id", schoolId);
      if (updErr) console.error("c2b-register-url: registered with Daraja but could not set registered_at");
    }

    // Own audit entry. No token, no URL: only what happened, to which shortcode, by whom.
    const { error: auditErr } = await admin.from("audit_log").insert({
      school_id: schoolId,
      actor_school_user_id: null,
      table_name: "mpesa_c2b_config",
      record_id: schoolId,
      action: "c2b_register_url",
      reason: outcome.ok ? "registered" : "registration_failed",
      new_data: {
        environment: "sandbox",
        shortcode,
        success: outcome.ok,
        daraja_response: outcome.ok ? outcome.description : reason,
        actor_user_id: userData.user.id,
      },
    });
    if (auditErr) console.error("c2b-register-url: audit write failed", auditErr.code);

    if (!outcome.ok) return json({ error: "Daraja did not accept the registration.", detail: reason }, 502);
    return json({ success: true, environment: "sandbox", shortcode, registered: true });
  } catch (err) {
    const msg = err instanceof Error ? redactToken(err.message, token) : "Unexpected error.";
    console.error("c2b-register-url: unexpected error", msg);
    return json({ error: "Unexpected error." }, 500);
  }
});
