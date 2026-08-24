import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

const KENYA_PHONE_RE = /^\+254\d{9}$/;

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
    const { phone, code, purpose = "login" } = await req.json();

    if (typeof phone !== "string" || !KENYA_PHONE_RE.test(phone)) {
      return json({ error: "A valid phone number in +254XXXXXXXXX format is required." }, 400);
    }
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return json({ error: "A valid 6-digit code is required." }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: isValid, error: verifyError } = await supabase.rpc("verify_otp", {
      p_phone: phone,
      p_code: code,
      p_purpose: purpose,
    });

    if (verifyError) {
      console.error("verify_otp error", verifyError);
      return json({ error: "Could not verify the code. Try again." }, 500);
    }

    if (!isValid) {
      return json({ error: "Invalid or expired code." }, 401);
    }

    // Schools pre-provision a parent/student's phone number (Admissions,
    // Phase 1) before they ever log in. This endpoint activates and links
    // an existing record — it never creates a school_users row out of
    // thin air.
    //
    // Fetched as a plain array (not .maybeSingle()) deliberately: a unique
    // index (uq_school_users_active_phone) now stops a second active row
    // sharing this phone from being created, but it can't retroactively
    // fix data that predates it. .maybeSingle() throws a raw Postgres
    // "multiple rows returned" error in that case, which surfaced to the
    // guardian as an opaque "Could not verify the code" 500 with no way to
    // tell what was actually wrong (found 2026-08-23: a phone shared by two
    // active guardian records at the same school locked that number out of
    // login entirely). Handling the array explicitly lets that case return
    // a clear, actionable message instead.
    const { data: schoolUsers, error: lookupError } = await supabase
      .from("school_users")
      .select("id, auth_user_id, full_name")
      .eq("phone", phone)
      .eq("status", "active");

    if (lookupError) {
      console.error("school_users lookup failed", lookupError);
      return json({ error: "Could not verify the code. Try again." }, 500);
    }

    if (!schoolUsers || schoolUsers.length === 0) {
      return json({ error: "No account is registered to this phone number." }, 404);
    }

    if (schoolUsers.length > 1) {
      console.error(
        `Ambiguous login: ${schoolUsers.length} active school_users rows share phone ${phone}`,
        schoolUsers.map((u) => u.id),
      );
      return json(
        {
          error:
            "This phone number is linked to more than one account. Please contact your school office to resolve this before signing in.",
        },
        409,
      );
    }

    const schoolUser = schoolUsers[0];

    let authUserId = schoolUser.auth_user_id as string | null;

    if (!authUserId) {
      // First-ever successful login for this pre-provisioned record:
      // create the real Supabase Auth identity and link it. Every
      // subsequent login reuses this same auth_user_id. The email here
      // is synthetic and internal-only — it exists purely so GoTrue has
      // an identifier to generate a session link against; it's never
      // shown to the user or used for delivery.
      const syntheticEmail = `${schoolUser.id}@phone.educore.internal`;
      const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email: syntheticEmail,
        email_confirm: true,
        phone,
        phone_confirm: true,
        user_metadata: { full_name: schoolUser.full_name, auth_provider: "otp" },
      });

      if (createError || !created?.user) {
        console.error("admin.createUser failed", createError);
        return json({ error: "Could not activate this account. Try again." }, 500);
      }

      authUserId = created.user.id;

      const { error: linkError } = await supabase
        .from("school_users")
        .update({ auth_user_id: authUserId })
        .eq("id", schoolUser.id);

      if (linkError) {
        console.error("linking auth_user_id failed", linkError);
        return json({ error: "Could not activate this account. Try again." }, 500);
      }
    }

    // Standard bridge from a fully custom OTP flow into a genuine
    // Supabase session: generate a magic-link token server-side, hand
    // only its hash to the client, which redeems it locally via
    // supabase.auth.verifyOtp({ token_hash, type: 'magiclink' }). If the
    // OTP transport ever changes (different SMS provider, WhatsApp,
    // etc.), nothing below this point needs to change.
    const { data: authUser, error: getUserError } = await supabase.auth.admin.getUserById(
      authUserId,
    );

    if (getUserError || !authUser?.user?.email) {
      console.error("could not resolve linked auth user's email", getUserError);
      return json({ error: "Could not start a session. Try again." }, 500);
    }

    const { data: link, error: linkGenError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: authUser.user.email,
    });

    if (linkGenError || !link) {
      console.error("generateLink failed", linkGenError);
      return json({ error: "Could not start a session. Try again." }, 500);
    }

    return json({
      success: true,
      token_hash: link.properties.hashed_token,
      verify_type: "magiclink",
    });
  } catch (err) {
    console.error(err);
    return json({ error: "Unexpected error." }, 500);
  }
});
