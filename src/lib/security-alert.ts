// Fires an operational alert for security-relevant events: rate limit trips,
// rejected webhook signatures/tokens, and similar signals worth a human
// looking at promptly rather than sitting unread in audit_log/api_request_logs.
// Two independent channels, neither gating the other: a Slack push (if
// SECURITY_ALERT_WEBHOOK_URL is configured) and a durable row in
// platform_alerts for the /admin/system-health digest. See
// supabase/functions/_shared/securityAlert.ts for the Deno-side mirror used
// by edge functions/webhooks, which writes to the same table.
//
// Deliberately fail-safe: neither channel failing (Slack down, DB write
// rejected, SECURITY_ALERT_WEBHOOK_URL unset) may throw or slow down the
// request this is attached to. An alerting outage is not a reason to
// degrade the actual feature.
//
// Deliberately light on PII in the message/detail: enough to act on (event
// type, bucket/identifier, IP, timestamp) without echoing full emails,
// phone numbers, or request bodies -- same posture as sendDefaultPii: false
// in the Sentry configs.
export async function sendSecurityAlert(event: string, detail: Record<string, string>) {
  await Promise.allSettled([sendSlackAlert(event, detail), writePlatformAlert(event, detail)]);
}

async function sendSlackAlert(event: string, detail: Record<string, string>) {
  const webhookUrl = process.env.SECURITY_ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;

  const lines = Object.entries(detail)
    .map(([k, v]) => `• *${k}*: ${v}`)
    .join("\n");
  const text = `:rotating_light: *${event}*\n${lines}\n• *when*: ${new Date().toISOString()}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    // Never let a failed/slow alert affect the caller -- just log it so it
    // shows up in normal error monitoring instead.
    console.error("sendSecurityAlert: failed to notify Slack", event, err);
  }
}

async function writePlatformAlert(event: string, detail: Record<string, string>) {
  try {
    // Dynamic import: this file is called from public/unauthenticated routes
    // (login, signup, forgot-password, contact, apply) where pulling in the
    // full admin-client module unconditionally isn't worth it on the happy
    // path where nothing failed and this function never runs at all.
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const supabase = createAdminClient();
    const { error } = await supabase.from("platform_alerts").insert({ event, detail });
    if (error) console.error("sendSecurityAlert: failed to write platform_alerts", event, error);
  } catch (err) {
    console.error("sendSecurityAlert: failed to write platform_alerts", event, err);
  }
}
