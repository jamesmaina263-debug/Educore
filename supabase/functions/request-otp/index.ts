import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getSmsProvider } from "../_shared/sms/index.ts";

const KENYA_PHONE_RE = /^\+254\d{9}$/;

Deno.serve(async (req) => {
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
    // SMS-bomb a number.
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
