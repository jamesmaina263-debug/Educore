import { createClient } from "jsr:@supabase/supabase-js@2.112.4";
import { getEmailProvider } from "../_shared/email/index.ts";
import { timingSafeEqual } from "../_shared/timingSafeEqual.ts";
import { buildFollowupDigest, nairobiToday, type DigestLead } from "../_shared/followupDigest.ts";

// Emails the platform owner the day's sales follow-ups: overdue and due today. Read-only apart from the one
// email: it never edits a lead.
//
// Called by the /api/cron/followup-digest Vercel Cron route (daily), with no user session, so it
// authenticates with the shared DISPATCH_SECRET in x-dispatch-secret -- the same server-to-server secret and
// constant-time compare as send-prospect-sequence. An unset DISPATCH_SECRET disables this endpoint.
//
// Recipient: FOLLOWUP_DIGEST_TO, else PLATFORM_ADMIN_EMAIL, else admin@educoreafrica.com (the same fallback
// notify-platform-admin uses). Nothing is sent when there is nothing to chase. A real Resend key is required:
// the console fallback would make this report success while sending nothing, so it is refused.
Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const dispatchSecret = Deno.env.get("DISPATCH_SECRET");
  const provided = req.headers.get("x-dispatch-secret");
  if (!dispatchSecret || !provided || !timingSafeEqual(provided, dispatchSecret)) {
    return json({ error: "Unauthorized." }, 401);
  }
  if (!Deno.env.get("RESEND_API_KEY") || !Deno.env.get("RESEND_FROM_ADDRESS")) {
    return json({ error: "RESEND_API_KEY and RESEND_FROM_ADDRESS must be set before the digest can send." }, 500);
  }

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await admin
      .from("sales_leads")
      .select("id, school_name, contact_name, phone, stage, next_follow_up_on, town_county")
      .not("stage", "in", "(paid,lost)")
      .limit(1000);
    if (error) return json({ error: error.message }, 500);

    const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://www.educoreafrica.com").replace(/\/$/, "");
    const digest = buildFollowupDigest((data ?? []) as DigestLead[], nairobiToday(new Date()), siteUrl);
    if (!digest) return json({ sent: false, reason: "Nothing overdue or due today." });

    const to = Deno.env.get("FOLLOWUP_DIGEST_TO") ?? Deno.env.get("PLATFORM_ADMIN_EMAIL") ?? "admin@educoreafrica.com";
    await getEmailProvider().send(to, digest.subject, digest.text, undefined, undefined, { html: digest.html });
    return json({ sent: true, overdue: digest.overdue, due_today: digest.dueToday, no_follow_up: digest.noFollowUp });
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
