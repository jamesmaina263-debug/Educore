import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { getSmsProvider } from "../_shared/sms/index.ts";

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
    const { phone, purpose = "login" } = await req.json();

    if (typeof phone !== "string" || !KENYA_PHONE_RE.test(phone)) {
      return json({ error: "A valid phone number in +254XXXXXXXXX format is required." }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Abuse guard on the request side (separate from verify_otp's own
    // 5-attempt cap): don't allow a new code within 60s of the last one
    // for the same phone+purpose. Prevents this endpoint being used to
    // SMS-bomb a number in rapid succession.
    const { data: recent } = await supabase
      .from("otp_codes")
      .select("created_at")
      .eq("phone", phone)
      .eq("purpose", purpose)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recent && Date.now() - new Date(recent.created_at as string).getTime() < 60_000) {
      return json({ error: "Please wait before requesting another code." }, 429);
    }

    // Two further caps, both using the same increment_and_check_rate_limit()
    // primitive signUpSchool() already relies on (src/app/signup/actions.ts):
    // the 60s cooldown above only throttles *rapid* requests for one phone
    // number, it doesn't bound the total volume over a longer window, and it
    // does nothing at all against many different phone numbers being hit
    // from one source. This closes both gaps: a per-phone daily ceiling
    // (SMS-cost abuse against one number, low-and-slow) and a per-IP hourly
    // ceiling (many numbers messaged from one source/script).
    const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const [{ data: withinPhoneLimit }, { data: withinIpLimit }] = await Promise.all([
      supabase.rpc("increment_and_check_rate_limit", {
        p_bucket: `otp-request-phone:${phone}:${purpose}`,
        p_max_events: 10,
        p_window_seconds: 86_400,
      }),
      supabase.rpc("increment_and_check_rate_limit", {
        p_bucket: `otp-request-ip:${ipAddress}`,
        p_max_events: 20,
        p_window_seconds: 3_600,
      }),
    ]);

    if (withinPhoneLimit === false) {
      return json({ error: "Too many code requests for this number today. Please try again tomorrow." }, 429);
    }
    if (withinIpLimit === false) {
      return json({ error: "Too many requests from this network. Please try again later." }, 429);
    }

    const { data: code, error } = await supabase.rpc("generate_otp", {
      p_phone: phone,
      p_purpose: purpose,
    });

    if (error || !code) {
      console.error("generate_otp failed", error);
      return json({ error: "Could not generate a code. Try again shortly." }, 500);
    }

    await getSmsProvider().send(
      phone,
      `Your EduCore verification code is ${code}. It expires in 10 minutes.`,
    );

    return json({ success: true });
  } catch (err) {
    console.error(err);
    return json({ error: "Unexpected error." }, 500);
  }
});
