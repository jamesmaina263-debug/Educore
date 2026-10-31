import { createClient } from "jsr:@supabase/supabase-js@2.112.4";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { getEmailProvider } from "../_shared/email/index.ts";
import { renderCampaignEmail, trackOutreachLinks } from "../_shared/campaignEmail.ts";

// Sends a promotional campaign (school owners or prospects), one small batch per call.
//
// Caller must be a platform super_admin (a real user JWT -- the service role is NOT accepted,
// so nothing server-side can fire a campaign by accident). Two modes:
//   { campaign_id }            -> claim up to 20 queued recipients, send, report what is left.
//                                 The admin UI calls this repeatedly until remaining === 0.
//   { test: true, subject, body } -> send ONE copy to the caller's own login email only.
//
// ONE narrow exception to "super admin only": the onboarding monitor's two automatic service emails
// (password reminder, login guidance). The scheduled job calls with a shared secret (ONBOARDING_SEND_SECRET, never
// sent by a browser) and { onboarding_nudge_id }. That mode can NEVER take a campaign id from the caller and can
// never send a test: it resolves the campaign from a queued trial_nudges row created by the monitor (auto_rule is
// set) and runs onboarding_recheck_before_send first, which re-verifies the school's current state, that automation
// is still switched on with approved templates, suppression, asked_to_stop and the trial-nudge caps. Without the
// secret configured the mode is simply off. Every other caller still needs a real super-admin user JWT.
//
// Sender identity comes from CAMPAIGN_FROM_ADDRESS / CAMPAIGN_REPLY_TO. It deliberately does NOT
// fall back to RESEND_FROM_ADDRESS (the transactional sender): promotional mail must never go out
// under the OTP/billing identity, or a spam complaint would hurt their deliverability.
const BATCH_SIZE = 20;

type Audience = "owners" | "prospects" | "outreach";
function audienceOf(a: unknown): Audience {
  return a === "outreach" ? "outreach" : a === "prospects" ? "prospects" : "owners";
}

// Constant-time comparison (compares SHA-256 digests so length differences do not leak either).
async function secretsMatch(presented: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(presented)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header." }, 401);

    // Onboarding service mode: only when a secret is configured (>= 32 chars) AND the caller presents it.
    const onboardingSecret = Deno.env.get("ONBOARDING_SEND_SECRET") ?? "";
    const presentedSecret = req.headers.get("x-onboarding-send-secret") ?? "";
    const onboardingService =
      presentedSecret !== "" && onboardingSecret.length >= 32 && (await secretsMatch(presentedSecret, onboardingSecret));

    let callerEmail: string | undefined;
    if (!onboardingService) {
      const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData.user) return json({ error: "Not signed in." }, 401);

      const { data: isSuperAdmin } = await userClient.rpc("auth_is_super_admin");
      if (isSuperAdmin !== true) return json({ error: "Only a platform super admin can send campaigns." }, 403);
      callerEmail = userData.user.email ?? undefined;
    }

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
    if (onboardingService && payload.test === true) return json({ error: "Not available in service mode." }, 403);

    // ---- Test mode: one email, to the signed-in admin's own address, nobody else ----
    if (payload.test === true) {
      const to = callerEmail;
      const subject = String(payload.subject ?? "").trim();
      const body = String(payload.body ?? "").trim();
      if (!to) return json({ error: "Your account has no email address to send a test to." }, 400);
      if (!subject || !body) return json({ error: "Subject and body are required." }, 400);

      const unsubscribeUrl = `${siteUrl}/unsubscribe/00000000-0000-0000-0000-000000000000`;
      // Outreach test emails carry the same tracked links as real ones, with an id that matches no school, so
      // the links can be tried end to end but nothing is recorded.
      const testBody = payload.audience === "outreach" ? trackOutreachLinks(body, "00000000-0000-0000-0000-000000000000", siteUrl) : body;
      const { text, html } = renderCampaignEmail({
        body: testBody,
        recipientName: "Test Owner",
        schoolName: "Your School (test)",
        unsubscribeUrl,
        audience: audienceOf(payload.audience),
      });
      const testFrom = payload.audience === "outreach" ? (Deno.env.get("OUTREACH_FROM_ADDRESS") ?? fromAddress) : fromAddress;
      const testReplyTo = payload.audience === "outreach" ? (Deno.env.get("OUTREACH_REPLY_TO") ?? replyTo) : replyTo;
      await provider.send(to, `[TEST] ${subject}`, text, undefined, testFrom, { html, replyTo: testReplyTo });
      return json({ sent_to: to });
    }

    // ---- Real send: one batch ----
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let campaignId = String(payload.campaign_id ?? "");
    let onboardingNudgeId = "";
    if (onboardingService) {
      // The caller names a nudge, never a campaign. A campaign_id in the body is ignored.
      onboardingNudgeId = String(payload.onboarding_nudge_id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(onboardingNudgeId)) return json({ error: "onboarding_nudge_id is required." }, 400);
      const { data: nudge } = await admin
        .from("trial_nudges")
        .select("id, campaign_id, status, auto_rule")
        .eq("id", onboardingNudgeId)
        .maybeSingle();
      if (!nudge || !nudge.auto_rule || !nudge.campaign_id) return json({ error: "Not an automatic onboarding message." }, 403);
      campaignId = nudge.campaign_id;

      // If an earlier run already sent (or failed) it but did not get to record it, record it now and stop.
      const { data: rec } = await admin
        .from("email_campaign_recipients")
        .select("status, error")
        .eq("campaign_id", campaignId)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (rec && rec.status !== "queued") {
        if (rec.status === "sent") {
          await admin.rpc("onboarding_record_delivery", { p_nudge_id: onboardingNudgeId, p_ok: true, p_error: null });
          return json({ sent: 0, failed: 0, remaining: 0, recorded: "sent" });
        }
        if (rec.status === "failed" || rec.status === "skipped_unsubscribed") {
          await admin.rpc("onboarding_record_delivery", {
            p_nudge_id: onboardingNudgeId,
            p_ok: false,
            p_error: rec.status === "skipped_unsubscribed" ? "The owner unsubscribed before this was sent." : (rec.error ?? "Send failed."),
          });
          return json({ sent: 0, failed: 1, remaining: 0, recorded: "failed" });
        }
        // 'sending': an interrupted send is never auto-retried (a duplicate email is worse than a missed one).
        return json({ sent: 0, failed: 0, remaining: 0, pending: "sending" });
      }

      // The last check before anything is sent. It cancels the message itself when it fails.
      const { data: gate, error: gateErr } = await admin.rpc("onboarding_recheck_before_send", { p_nudge_id: onboardingNudgeId });
      if (gateErr) return json({ error: gateErr.message }, 500);
      if (!gate || gate.ok !== true) return json({ sent: 0, failed: 0, remaining: 0, cancelled: String(gate?.reason ?? "check_failed") });
    } else if (!/^[0-9a-f-]{36}$/i.test(campaignId)) {
      return json({ error: "campaign_id is required." }, 400);
    }

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

    const audience = audienceOf(campaign.audience);
    // Outreach may use its own sender so cold-email complaints can't hurt the owner/billing sender.
    const sendFrom = audience === "outreach" ? (Deno.env.get("OUTREACH_FROM_ADDRESS") ?? fromAddress) : fromAddress;
    const sendReplyTo = audience === "outreach" ? (Deno.env.get("OUTREACH_REPLY_TO") ?? replyTo) : replyTo;

    // Per-recipient content (outreach): the exact subject/body that was reviewed when the campaign was created.
    const custom = new Map<string, { custom_subject: string | null; custom_body: string | null; prospect_id: string | null }>();
    if ((claimed ?? []).length > 0) {
      const { data: extra } = await admin
        .from("email_campaign_recipients")
        .select("id, custom_subject, custom_body, prospect_id")
        .in("id", (claimed ?? []).map((r: { id: string }) => r.id));
      for (const e of extra ?? []) custom.set(e.id, e);
    }

    let sent = 0;
    let failed = 0;
    for (const r of claimed ?? []) {
      const c = custom.get(r.id);
      const subject = (c?.custom_subject ?? "").trim() || campaign.subject;
      const bodyText = (c?.custom_body ?? "").trim() || campaign.body;
      if (audience === "outreach" && (!c?.custom_subject || !c?.custom_body)) {
        // Never send the generic placeholder body to a school.
        await admin
          .from("email_campaign_recipients")
          .update({ status: "failed", error: "Missing reviewed draft; not sent." })
          .eq("id", r.id);
        failed++;
        continue;
      }
      const unsubscribeUrl = `${siteUrl}/unsubscribe/${r.unsubscribe_token}`;
      // Outreach only: each school gets its own tracked links (recipient id), so a click shows which school it was.
      const trackedBody = audience === "outreach" ? trackOutreachLinks(bodyText, r.id, siteUrl) : bodyText;
      const { text, html } = renderCampaignEmail({
        body: trackedBody,
        recipientName: r.recipient_name,
        schoolName: r.school_name,
        unsubscribeUrl,
        audience,
      });
      try {
        await provider.send(r.email, subject, text, undefined, sendFrom, {
          html,
          replyTo: sendReplyTo,
          headers: {
            "List-Unsubscribe": `<${siteUrl}/api/unsubscribe/${r.unsubscribe_token}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
        await admin
          .from("email_campaign_recipients")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", r.id);
        if (c?.prospect_id) {
          // Best effort: shows "emailed" on the Outreach page so nobody is contacted twice.
          await admin.from("outbound_contact_log").insert({
            prospect_id: c.prospect_id,
            channel: "email",
            event: "sent",
            note: "Sent via outreach email campaign",
          });
        }
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

    if (onboardingService) {
      // Close the loop in the monitor's audit trail (attempted -> succeeded / failed).
      if (sent > 0 && failed === 0) {
        await admin.rpc("onboarding_record_delivery", { p_nudge_id: onboardingNudgeId, p_ok: true, p_error: null });
      } else if (failed > 0) {
        const { data: out } = await admin
          .from("email_campaign_recipients")
          .select("error")
          .eq("campaign_id", campaignId)
          .eq("status", "failed")
          .limit(1)
          .maybeSingle();
        await admin.rpc("onboarding_record_delivery", {
          p_nudge_id: onboardingNudgeId,
          p_ok: false,
          p_error: out?.error ?? "Send failed.",
        });
      }
    }

    return json({ sent, failed, remaining: remaining ?? 0 });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
