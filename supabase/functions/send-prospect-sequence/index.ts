import { createClient } from "jsr:@supabase/supabase-js@2.112.4";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { getEmailProvider } from "../_shared/email/index.ts";
import { renderCampaignEmail } from "../_shared/campaignEmail.ts";
import { timingSafeEqual } from "../_shared/timingSafeEqual.ts";

// Sends the due steps of the automated prospect email sequence, one small batch per call.
//
// Called by the /api/cron/prospect-sequence Vercel Cron route (daily), which loops until a call
// claims fewer than BATCH_SIZE. There is no user session, so the caller authenticates with the
// shared DISPATCH_SECRET in x-dispatch-secret -- the same server-to-server secret and constant-time
// compare that send-communication uses. An unset DISPATCH_SECRET disables this endpoint.
//
// All the "who is due" logic lives in the claim_prospect_sequence_sends() SQL function: it returns
// nothing unless the sequence is switched on, skips unsubscribed and already-onboarded prospects,
// and inserts the (email, step) row BEFORE we send so the same step can never go out twice. A row
// left in 'sending' by an interrupted run is never retried automatically.
//
// Sender identity is CAMPAIGN_FROM_ADDRESS / CAMPAIGN_REPLY_TO, never the transactional sender,
// for the same deliverability reason as send-owner-campaign.
const BATCH_SIZE = 40;

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const dispatchSecret = Deno.env.get("DISPATCH_SECRET");
    const provided = req.headers.get("x-dispatch-secret");
    if (!dispatchSecret || !provided || !timingSafeEqual(provided, dispatchSecret)) {
      return json({ error: "Unauthorized." }, 401);
    }

    const fromAddress = Deno.env.get("CAMPAIGN_FROM_ADDRESS");
    const replyTo = Deno.env.get("CAMPAIGN_REPLY_TO");
    const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://www.educoreafrica.com").replace(/\/$/, "");
    if (!fromAddress || !replyTo) {
      return json({ error: "CAMPAIGN_FROM_ADDRESS and CAMPAIGN_REPLY_TO must be set before the sequence can send." }, 500);
    }
    if (!Deno.env.get("RESEND_API_KEY")) return json({ error: "RESEND_API_KEY is not configured." }, 500);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const provider = getEmailProvider();

    const { data: claimed, error: claimErr } = await admin.rpc("claim_prospect_sequence_sends", { p_limit: BATCH_SIZE });
    if (claimErr) return json({ error: claimErr.message }, 500);

    let sent = 0;
    let failed = 0;
    for (const r of claimed ?? []) {
      const unsubscribeUrl = `${siteUrl}/unsubscribe/${r.unsubscribe_token}`;
      const { text, html } = renderCampaignEmail({
        body: r.body,
        recipientName: r.prospect_name,
        schoolName: r.org_name,
        unsubscribeUrl,
        audience: "prospects",
      });
      try {
        await provider.send(r.email, r.subject, text, undefined, fromAddress, {
          html,
          replyTo,
          headers: {
            "List-Unsubscribe": `<${siteUrl}/api/unsubscribe/${r.unsubscribe_token}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
        await admin
          .from("prospect_sequence_sends")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", r.id);
        sent++;
      } catch (e) {
        await admin
          .from("prospect_sequence_sends")
          .update({ status: "failed", error: String(e instanceof Error ? e.message : e).slice(0, 500) })
          .eq("id", r.id);
        failed++;
      }
    }

    return json({ claimed: (claimed ?? []).length, sent, failed });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
