import { createClient } from "jsr:@supabase/supabase-js@2.112.4";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { getDarajaOAuthToken } from "../_shared/mpesa/daraja.ts";
import { sendSecurityAlert } from "../_shared/securityAlert.ts";
import {
  buildC2bConfirmationUrl,
  buildC2bRegisterRequest,
  c2bRegisterEndpoint,
  C2B_FLAG_KEY,
  checkProductionRegistrationState,
  checkProductionUrl,
  checkRegistrationPreconditions,
  confirmationMatches,
  interpretC2bRegisterResponse,
  looksLikeAlreadyRegistered,
  redactedUrl,
  redactToken,
} from "../_shared/mpesa/c2bRegistration.ts";

// Registers a school's C2B confirmation URL with Daraja in PRODUCTION. Separate from c2b-register-url
// (sandbox) on purpose: that function stays untouched, and this one cannot be pointed at sandbox.
//
// Production registration is effectively ONE-TIME. Safaricom has no unregister API; changing a registered
// URL means deleting it on the Daraja portal (Self Service > URL Management) or asking Safaricom. So:
//   * Caller must be a platform super_admin with a real user JWT (aal2 where MFA is enforced).
//   * Body: { school_id, dry_run?, confirm_shortcode? }. dry_run DEFAULTS TO TRUE and changes nothing: it
//     runs every check, proves the school's Daraja credentials can get a production token, and shows the
//     exact address with the secret hidden. It sends nothing to Safaricom's Register URL.
//   * A real registration needs dry_run:false AND confirm_shortcode equal to the school's shortcode, typed.
//   * It refuses unless: flag on, production + active + PAYBILL + credentials saved, never registered,
//     and the school is still in log_only mode.
//   * It NEVER retries and never returns, logs or audits the confirmation token or the full URL.
//   * Every real attempt writes one audit_log entry and one alert. Dry runs write nothing.
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
    // Dry run unless explicitly false: a missing or mistyped field must never trigger a real registration.
    const dryRun = payload.dry_run !== false;

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const [{ data: flagEnabled }, { data: settings }, { data: credsRows, error: credsError }, { data: config }] =
      await Promise.all([
        admin.rpc("school_has_feature_flag", { p_school_id: schoolId, p_key: C2B_FLAG_KEY }),
        admin.from("mpesa_settings").select("shortcode, is_active, environment, shortcode_type").eq("school_id", schoolId).maybeSingle(),
        admin.rpc("get_mpesa_credentials_decrypted", { p_school_id: schoolId }),
        admin.from("mpesa_c2b_config").select("registered_at, mode").eq("school_id", schoolId).maybeSingle(),
      ]);
    const credsRow = credsRows?.[0];
    if (credsError) console.error("c2b-register-url-prod: get_mpesa_credentials_decrypted failed");

    const pre = checkRegistrationPreconditions(
      {
        flagEnabled: flagEnabled === true,
        settings: settings ?? null,
        hasCredentials: !!(credsRow && credsRow.consumer_key && credsRow.consumer_secret),
      },
      "production",
    );
    if (!pre.ok) return json({ error: pre.message, code: pre.code }, 422);

    const state = checkProductionRegistrationState({
      registeredAt: (config?.registered_at as string | null) ?? null,
      mode: (config?.mode as string | null) ?? null,
    });
    if (!state.ok) return json({ error: state.message, code: state.code }, 422);

    const shortcode = String(settings!.shortcode).trim();
    const endpoint = c2bRegisterEndpoint("production");
    const creds = {
      shortcode,
      consumerKey: credsRow.consumer_key,
      consumerSecret: credsRow.consumer_secret,
      passkey: credsRow.passkey ?? "",
      environment: "production" as const,
    };

    // ---- DRY RUN: nothing is written and nothing is sent to Register URL ----------------------------
    if (dryRun) {
      // The real token lives in mpesa_c2b_config. If the row does not exist yet, validate the URL shape with
      // a placeholder; the real run creates the row. Either way the token is never shown.
      let tokenForShape = "0".repeat(48);
      const { data: tokRow } = await admin.from("mpesa_c2b_config").select("confirmation_token").eq("school_id", schoolId).maybeSingle();
      if (tokRow?.confirmation_token) tokenForShape = tokRow.confirmation_token as string;
      token = tokenForShape;

      const url = buildC2bConfirmationUrl({ supabaseUrl, schoolId, token: tokenForShape });
      const urlCheck = checkProductionUrl(url);

      // Proves the saved Daraja key and secret can get a PRODUCTION token. Read-only on Safaricom's side.
      let oauthOk = false;
      let oauthNote: string | null = null;
      try {
        await getDarajaOAuthToken(creds);
        oauthOk = true;
      } catch (e) {
        oauthNote = redactToken(e instanceof Error ? e.message : "OAuth failed", token).slice(0, 120);
      }

      console.log("c2b-register-url-prod: dry run", { school_id: schoolId, url_ok: urlCheck.ok, oauth_ok: oauthOk });
      return json({
        dry_run: true,
        ready: urlCheck.ok && oauthOk,
        environment: "production",
        shortcode,
        would_register: {
          endpoint,
          response_type: "Completed",
          confirmation_and_validation_url: redactedUrl(url, token),
          config_row_exists: !!tokRow,
        },
        checks: {
          flag_on: true,
          production_active_paybill_with_credentials: true,
          never_registered: true,
          mode_log_only: true,
          url_passes_safaricom_rules: urlCheck.ok,
          url_problem: urlCheck.ok ? null : urlCheck.reason,
          daraja_production_token_obtained: oauthOk,
          daraja_token_problem: oauthNote,
        },
        warnings: [
          "Production registration is effectively one-time and has no unregister API.",
          "If this paybill already has URLs registered for another system, registering will fail. Do not delete them until you know what depends on them: deleting stops that system receiving payments.",
        ],
        next_step: `To register for real, send dry_run:false and confirm_shortcode:"${shortcode}".`,
      });
    }

    // ---- REAL RUN -----------------------------------------------------------------------------------
    if (!confirmationMatches(payload.confirm_shortcode, shortcode)) {
      return json(
        { error: "Typed confirmation required: send confirm_shortcode equal to the school's shortcode.", code: "confirmation_required" },
        422,
      );
    }

    // Create the config row if absent (token and mode come from column defaults), then read the token
    // server-side only. ignoreDuplicates keeps an existing row, and its token, untouched.
    const { error: insertErr } = await admin
      .from("mpesa_c2b_config")
      .upsert({ school_id: schoolId }, { onConflict: "school_id", ignoreDuplicates: true });
    if (insertErr) {
      console.error("c2b-register-url-prod: could not create config row", insertErr.code);
      return json({ error: "Could not create the C2B config row." }, 500);
    }
    const { data: fresh, error: freshErr } = await admin
      .from("mpesa_c2b_config")
      .select("confirmation_token, registered_at, mode")
      .eq("school_id", schoolId)
      .maybeSingle();
    if (freshErr || !fresh?.confirmation_token) return json({ error: "Could not read the C2B config row." }, 500);
    token = fresh.confirmation_token as string;

    // Re-check after the write, in case something changed between the first read and now.
    const state2 = checkProductionRegistrationState({
      registeredAt: (fresh.registered_at as string | null) ?? null,
      mode: (fresh.mode as string | null) ?? null,
    });
    if (!state2.ok) return json({ error: state2.message, code: state2.code }, 422);

    const confirmationUrl = buildC2bConfirmationUrl({ supabaseUrl, schoolId, token });
    const urlCheck = checkProductionUrl(confirmationUrl);
    if (!urlCheck.ok) return json({ error: urlCheck.reason, code: "url_not_allowed" }, 422);
    const request = buildC2bRegisterRequest({ shortcode, confirmationUrl });

    let outcome: ReturnType<typeof interpretC2bRegisterResponse>;
    let reachedDaraja = false;
    try {
      const accessToken = await getDarajaOAuthToken(creds);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify(request),
      });
      reachedDaraja = true;
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
      if (updErr) console.error("c2b-register-url-prod: registered with Daraja but could not set registered_at");
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
        environment: "production",
        shortcode,
        success: outcome.ok,
        daraja_response: outcome.ok ? outcome.description : reason,
        actor_user_id: userData.user.id,
      },
    });
    if (auditErr) console.error("c2b-register-url-prod: audit write failed", auditErr.code);

    void sendSecurityAlert(
      outcome.ok ? "C2B production URL REGISTERED for a school" : "C2B production URL registration FAILED",
      { school_id: schoolId, shortcode, success: String(outcome.ok), actor_user_id: userData.user.id },
    );

    if (!outcome.ok) {
      // Never retry. Say what to do next without guessing.
      let hint: string;
      if (!reachedDaraja) {
        hint =
          "The request may or may not have reached Safaricom. Check the Daraja portal (Self Service > URL Management) before trying again; a second attempt fails if the first one landed.";
      } else if (looksLikeAlreadyRegistered(reason ?? "")) {
        hint =
          "Safaricom says URLs may already be registered for this paybill. They might belong to another system. Find out what uses them BEFORE deleting anything on Self Service > URL Management; then re-run.";
      } else {
        hint = "Safaricom did not accept it. Nothing was recorded as registered. See the runbook before retrying.";
      }
      return json({ error: "Daraja did not accept the registration.", detail: reason, hint }, 502);
    }
    return json({
      success: true,
      environment: "production",
      shortcode,
      registered: true,
      mode: "log_only",
      note: "Nothing is recorded as a payment until the school owner switches to live.",
    });
  } catch (err) {
    const msg = err instanceof Error ? redactToken(err.message, token) : "Unexpected error.";
    console.error("c2b-register-url-prod: unexpected error", msg);
    return json({ error: "Unexpected error." }, 500);
  }
});
