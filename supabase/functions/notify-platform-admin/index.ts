// Called only by the notify_admin_new_demo_request() Postgres trigger via pg_net (see
// supabase/migrations/20260830120000_platform_admin_notifications.sql) -- never by a browser or
// a Supabase client session. verify_jwt is false for this function (set in config.toml) because
// a database trigger has no user session/JWT to present; the x-webhook-secret header below is
// what actually authenticates the caller instead. Deploy note: this function needs
// PLATFORM_NOTIFICATION_WEBHOOK_SECRET set to the same value stored in Vault as
// 'platform_notification_webhook_secret' (`supabase secrets set PLATFORM_NOTIFICATION_WEBHOOK_SECRET=...`),
// plus the same RESEND_API_KEY/RESEND_FROM_ADDRESS every other email-sending function already
// uses. Until both are set, this 401s (webhook secret) or falls back to ConsoleEmailProvider
// (Resend keys) -- either way the in-app notification row is unaffected, since that's inserted
// directly by the trigger, not by this function.
import { getEmailProvider } from "../_shared/email/index.ts";

const PLATFORM_ADMIN_EMAIL = Deno.env.get("PLATFORM_ADMIN_EMAIL") ?? "admin@educore.co.ke";
// Used only for the demo-request-assignment notification (kind: demo_request_assigned),
// so it reads as personally forwarded by the owner rather than a generic system email.
// Same literal address already hardcoded in src/app/(admin)/admin/company-email/page.tsx
// as the connected mailbox -- same Resend account/domain as RESEND_FROM_ADDRESS, see the
// opt-in `from` override comment in _shared/email/index.ts.
const ASSIGNMENT_FROM_ADDRESS = "james.maina@educoreafrica.com";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expectedSecret = Deno.env.get("PLATFORM_NOTIFICATION_WEBHOOK_SECRET");
  const providedSecret = req.headers.get("x-webhook-secret");
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  let payload: {
    kind?: string;
    name?: string;
    school_name?: string;
    email?: string;
    phone?: string;
    student_count?: number;
    message?: string;
    demo_request_id?: string;
    assignee_name?: string;
    assignee_email?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const leadDetailLines = [
    `<li><strong>Contact:</strong> ${payload.name ?? "—"}</li>`,
    `<li><strong>School:</strong> ${payload.school_name ?? "—"}</li>`,
    `<li><strong>Email:</strong> ${payload.email ?? "—"}</li>`,
    `<li><strong>Phone:</strong> ${payload.phone ?? "—"}</li>`,
    payload.student_count ? `<li><strong>Student count:</strong> ${payload.student_count}</li>` : "",
    payload.message ? `<li><strong>Message:</strong> ${payload.message}</li>` : "",
  ].filter(Boolean);

  if (payload.kind === "demo_request_assigned") {
    if (!payload.assignee_email) return json({ error: "Missing assignee_email" }, 400);

    const subject = `Demo request assigned to you: ${payload.school_name ?? payload.name ?? "Unknown school"}`;
    const lines = [
      `<p>Hi ${payload.assignee_name ?? ""}, this demo request has been assigned to you.</p>`,
      `<ul>`,
      ...leadDetailLines,
      `</ul>`,
      `<p><a href="https://www.educoreafrica.com/admin/demo-requests">View in the Platform Admin Console</a></p>`,
    ].join("\n");

    try {
      const emailProvider = getEmailProvider();
      await emailProvider.send(payload.assignee_email, subject, lines, undefined, ASSIGNMENT_FROM_ADDRESS);
      return json({ success: true });
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: message }, 500);
    }
  }

  if (payload.kind !== "demo_request") {
    return json({ error: "Unsupported kind" }, 400);
  }

  const subject = `New demo request: ${payload.school_name ?? payload.name ?? "Unknown school"}`;
  const lines = [
    `<p>A new demo request just came in on the EduCore marketing site.</p>`,
    `<ul>`,
    ...leadDetailLines,
    `</ul>`,
    `<p><a href="https://www.educoreafrica.com/admin/demo-requests">View in the Platform Admin Console</a></p>`,
  ].join("\n");

  try {
    const emailProvider = getEmailProvider();
    await emailProvider.send(PLATFORM_ADMIN_EMAIL, subject, lines);
    return json({ success: true });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});
