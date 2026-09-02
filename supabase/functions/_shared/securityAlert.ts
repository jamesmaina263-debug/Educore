// Deno/Edge Function mirror of src/lib/security-alert.ts (same file can't be
// imported across the Next.js/Deno boundary). Keep the two in sync if you
// change one -- see that file's comment for the full rationale.
export async function sendSecurityAlert(event: string, detail: Record<string, string>) {
  const webhookUrl = Deno.env.get("SECURITY_ALERT_WEBHOOK_URL");
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
    console.error("sendSecurityAlert: failed to notify", event, err);
  }
}
