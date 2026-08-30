import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { getSmsProvider } from "../_shared/sms/index.ts";
import { getEmailProvider } from "../_shared/email/index.ts";

const KENYA_PHONE_RE = /^\+254\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    // `channel` is optional and defaults to "sms" so every existing caller
    // that only ever sent `{ phone, purpose }` (the parent-login page prior
    // to this change, and src/app/apply/[slug]/actions.ts's guardian
    // verification step) keeps working unchanged. `identifier` is the new,
    // channel-agnostic field; `phone` is still accepted as an alias for it
    // when channel is "sms" (or omitted) so old request bodies don't break.
    const body = await req.json();
    const purpose = body.purpose ?? "login";
    const channel: "sms" | "email" = body.channel === "email" ? "email" : "sms";
    const identifier: unknown = body.identifier ?? body.phone;

    if (channel === "sms") {
      if (typeof identifier !== "string" || !KENYA_PHONE_RE.test(identifier)) {
        return json({ error: "A valid phone number in +254XXXXXXXXX format is required." }, 400);
      }
    } else {
      if (typeof identifier !== "string" || !EMAIL_RE.test(identifier)) {
        return json({ error: "A valid email address is required." }, 400);
      }
    }
    const phone = identifier as string; // kept as `phone` from here down to minimize the diff against the existing (working) body below

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
      .eq("channel", channel)
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
    // "otp-request-phone" kept exactly as-is for channel="sms" (the existing,
    // already-live bucket key) so this change doesn't reset anyone's current
    // SMS rate-limit counters; email gets its own bucket namespace.
    const rateLimitBucketPrefix = channel === "sms" ? "otp-request-phone" : "otp-request-email";
    const [{ data: withinPhoneLimit }, { data: withinIpLimit }] = await Promise.all([
      supabase.rpc("increment_and_check_rate_limit", {
        p_bucket: `${rateLimitBucketPrefix}:${phone}:${purpose}`,
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
      return json(
        { error: `Too many code requests for this ${channel === "sms" ? "number" : "address"} today. Please try again tomorrow.` },
        429,
      );
    }
    if (withinIpLimit === false) {
      return json({ error: "Too many requests from this network. Please try again later." }, 429);
    }

    const { data: code, error } = await supabase.rpc("generate_otp", {
      p_phone: phone,
      p_purpose: purpose,
      p_channel: channel,
    });

    if (error || !code) {
      console.error("generate_otp failed", error);
      return json({ error: "Could not generate a code. Try again shortly." }, 500);
    }

    if (channel === "sms") {
      await getSmsProvider().send(
        phone,
        `Your EduCore verification code is ${code}. It expires in 10 minutes.`,
      );
    } else {
      await getEmailProvider().send(
        phone, // holds the email address when channel === "email"
        "Your EduCore verification code",
        `Your EduCore verification code is ${code}. It expires in 10 minutes.`,
      );
    }

    return json({ success: true });
  } catch (err) {
    console.error(err);
    return json({ error: "Unexpected error." }, 500);
  }
});
