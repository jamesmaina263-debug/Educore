import { createClient } from "jsr:@supabase/supabase-js@2.112.4";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { getEmailProvider } from "../_shared/email/index.ts";
import { renderCampaignEmail } from "../_shared/campaignEmail.ts";

// Sends a promotional campaign (school owners or prospects), one small batch per call.
//
// Caller must be a platform super_admin (a real user JWT -- the service role is NOT accepted,
// so nothing server-side can fire a campaign by accident). Two modes:
//   { campaign_id }            -> claim up to 20 queued recipients, send, report what is left.
//                                 The admin UI calls this repeatedly until remaining === 0.
//   { test: true, subject, body } -> send ONE copy to the caller's own login email only.
//
// Sender identity comes from CAMPAIGN_FROM_ADDRESS / CAMPAIGN_REPLY_TO. It deliberately does NOT
// fall back to RESEND_FROM_ADDRESS (the transactional sender): promotional mail must never go out
// under the OTP/billing identity, or a spam complaint would hurt their deliverability.
const BATCH_SIZE = 20;

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header." }, 401);

    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Not signed in." }, 401);

    const { data: isSuperAdmin } = await userClient.rpc("auth_is_super_admin");
    if (isSuperAdmin !== true) return json({ error: "Only a platform super admin can send campaigns." }, 403);

    const fromAddress = Deno.env.get("CAMPAIGN_FROM_ADDRESS");
    const replyTo = Deno.env.get("CAMPAIGN_REPLY_TO");
    const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://www.educoreafrica.com").replace(/\/$/, "");
    if (!fromAddress || !replyTo) {
      return json({ error: "CAMPAIGN_FROM_ADDRESS and CAMPAIGN_REPLY_TO must be set before campaigns can be sent." }, 500);
    }
    if (!Deno.env.get("RESEND_API_KEY")) {
      return json({ error: "RESEND_API_KEY is not configured." }, 500);
    }

    const payload = await req.json().catch(() => ({}));
    const provider = getEmailProvider();

    // ---- Test mode: one email, to the signed-in admin's own address, nobody else ----
    if (payload.test === true) {
      const to = userData.user.email;
      const subject = String(payload.subject ?? "").trim();
      const body = String(payload.body ?? "").trim();
      if (!to) return json({ error: "Your account has no email address to send a test to." }, 400);
      if (!subject || !body) return json({ error: "Subject and body are required." }, 400);

      const unsubscribeUrl = `${siteUrl}/unsubscribe/00000000-0000-0000-0000-000000000000`;
      const { text, html } = renderCampaignEmail({
        body,
        recipientName: "Test Owner",
        schoolName: "Your School (test)",
        unsubscribeUrl,
        audience: payload.audience === "prospects" ? "prospects" : "owners",
      });
      await provider.send(to, `[TEST] ${subject}`, text, undefined, fromAddress, { html, replyTo });
      return json({ sent_to: to });
    }

    // ---- Real send: one batch ----
    const campaignId = String(payload.campaign_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return json({ error: "campaign_id is required." }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: campaign, error: campErr } = await admin
      .from("email_campaigns")
      .select("id, subject, body, audience")
      .eq("id", campaignId)
      .single();
    if (campErr || !campaign) return json({ error: "Campaign not found." }, 404);

    const { data: claimed, error: claimErr } = await admin.rpc("claim_campaign_recipients", {
      p_campaign_id: campaignId,
      p_limit: BATCH_SIZE,
    });
    if (claimErr) return json({ error: claimErr.message }, 500);

    let sent = 0;
    let failed = 0;
    for (const r of claimed ?? []) {
      const unsubscribeUrl = `${siteUrl}/unsubscribe/${r.unsubscribe_token}`;
      const { text, html } = renderCampaignEmail({
        body: campaign.body,
        recipientName: r.recipient_name,
        schoolName: r.school_name,
        unsubscribeUrl,
        audience: campaign.audience === "prospects" ? "prospects" : "owners",
      });
      try {
        await provider.send(r.email, campaign.subject, text, undefined, fromAddress, {
          html,
          replyTo,
          headers: {
            "List-Unsubscribe": `<${siteUrl}/api/unsubscribe/${r.unsubscribe_token}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
        await admin
          .from("email_campaign_recipients")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", r.id);
        sent++;
      } catch (e) {
        await admin
          .from("email_campaign_recipients")
          .update({ status: "failed", error: String(e instanceof Error ? e.message : e).slice(0, 500) })
          .eq("id", r.id);
        failed++;
      }
    }

    const { count: remaining } = await admin
      .from("email_campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "queued");

    return json({ sent, failed, remaining: remaining ?? 0 });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
