// Fires an operational alert to Slack for security-relevant events: rate
// limit trips, rejected webhook signatures/tokens, and similar signals
// worth a human looking at promptly rather than sitting unread in
// audit_log/api_request_logs.
//
// Deliberately fail-safe: if SECURITY_ALERT_WEBHOOK_URL isn't configured
// (e.g. local dev, or before you've set this up), or the Slack POST itself
// fails or times out, this must never throw and must never slow down or
// block the request it's attached to. An alerting outage is not a reason
// to degrade the actual feature.
//
// Deliberately light on PII in the message body: enough to act on (event
// type, bucket/identifier, IP, timestamp) without echoing full emails,
// phone numbers, or request bodies into a Slack channel -- same posture as
// sendDefaultPii: false in the Sentry configs.
export async function sendSecurityAlert(event: string, detail: Record<string, string>) {
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
    console.error("sendSecurityAlert: failed to notify", event, err);
  }
}
