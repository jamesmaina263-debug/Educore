import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TRACKED_EVENT_TYPES, parseResendEvent, verifySvixSignature } from "@/lib/resend-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/webhooks/resend -> records Resend delivery events (delivered, bounced, complained, delayed, failed)
// in public.email_delivery_events so /admin/analytics can show whether outreach reaches inboxes.
//
// Public by necessity (Resend calls it), so it is authenticated by the Svix signature on the raw body, checked
// before anything is parsed or stored. Without RESEND_WEBHOOK_SECRET it answers 503, never 200, so Resend keeps
// retrying instead of dropping events once the secret is added. Recording is idempotent on the svix-id, so a
// retried delivery is stored once. A database failure answers 500 for the same reason.
//
// Read-only with respect to email sending: it never sends, edits or suppresses anything.
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "RESEND_WEBHOOK_SECRET is not configured." }, { status: 503 });
  }

  const body = await request.text();
  const svixId = request.headers.get("svix-id");
  const valid = verifySvixSignature({
    id: svixId,
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
    body,
    secret,
  });
  if (!valid || !svixId) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let event;
  try {
    event = parseResendEvent(JSON.parse(body));
  } catch {
    event = null;
  }
  if (!event) return NextResponse.json({ ok: true, ignored: "unreadable payload" });
  if (!TRACKED_EVENT_TYPES.has(event.eventType)) return NextResponse.json({ ok: true, ignored: event.eventType });

  try {
    const { error } = await createAdminClient().rpc("record_email_event", {
      p_svix_id: svixId,
      p_event_type: event.eventType,
      p_occurred_at: event.occurredAt,
      p_email_id: event.emailId,
      p_from: event.from,
      p_to: event.to,
      p_subject: event.subject,
      p_bounce_type: event.bounceType,
      p_bounce_reason: event.bounceReason,
    });
    if (error) {
      console.error("resend webhook: record_email_event failed", error.message);
      return NextResponse.json({ error: "Could not record the event." }, { status: 500 });
    }
  } catch (err) {
    console.error("resend webhook: unexpected error", err);
    return NextResponse.json({ error: "Could not record the event." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
