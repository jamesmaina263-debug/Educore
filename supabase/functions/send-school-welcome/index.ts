import { createClient } from "jsr:@supabase/supabase-js@2.112.4";
import { getEmailProvider } from "../_shared/email/index.ts";
import { renderSchoolWelcomeEmail } from "../_shared/schoolWelcomeEmail.ts";
import { timingSafeEqual } from "../_shared/timingSafeEqual.ts";

// Sends the one-time "Welcome to EduCore Africa" email to a newly registered school.
//
// Called server-to-server by the signup server action (src/lib/signup/send-welcome-email.ts) right after the
// school has been created. It is a separate email from the set-password email, which Supabase Auth sends and
// which this function never touches.
//
// Auth: verify_jwt is false (see config.toml) and the caller must present the shared x-dispatch-secret
// (DISPATCH_SECRET), the same server-to-server mechanism send-platform-invoice / send-communication use.
//
// The recipient and the school name are read from the database by school_id -- never taken from the request --
// so a caller cannot make this endpoint email an arbitrary address or put arbitrary text in the message.
//
// Send-once guarantee: schools.welcome_email_sent_at is claimed with one atomic
// `update ... where welcome_email_sent_at is null`. Of any number of concurrent or repeated calls for the same
// school, exactly one wins the claim and sends; the rest return { sent: false, reason: "already_sent" }. The
// claim is released only if the provider refused the message, so a failed send can be retried later. Schools
// that existed before this feature shipped were backfilled by the migration and are never emailed.
//
// Safety: refuses to run if Resend is not configured (getEmailProvider() would otherwise fall back to a console
// logger and we would mark a welcome email as sent that never left the building) -- and it checks that BEFORE
// claiming, so nothing is consumed.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const dispatchSecret = Deno.env.get("DISPATCH_SECRET");
  const providedSecret = req.headers.get("x-dispatch-secret");
  if (!dispatchSecret || !providedSecret || !timingSafeEqual(providedSecret, dispatchSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let schoolId: string | undefined;
  try {
    const body = await req.json();
    schoolId = typeof body?.school_id === "string" ? body.school_id.trim() : undefined;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!schoolId || !UUID_RE.test(schoolId)) return json({ error: "school_id (uuid) is required" }, 400);

  if (!Deno.env.get("RESEND_API_KEY") || !Deno.env.get("RESEND_FROM_ADDRESS")) {
    console.error("send-school-welcome: RESEND_API_KEY/RESEND_FROM_ADDRESS not configured -- not sending, not claiming");
    return json({ error: "Email provider is not configured." }, 503);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Atomic claim: only the caller that flips NULL -> now() gets a row back.
  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await db
    .from("schools")
    .update({ welcome_email_sent_at: claimedAt })
    .eq("id", schoolId)
    .is("welcome_email_sent_at", null)
    .select("id, name, email")
    .maybeSingle();
  if (claimError) {
    console.error("send-school-welcome: claim failed", claimError.code);
    return json({ error: "Could not record the welcome email." }, 500);
  }
  if (!claimed) {
    // Already sent (or claimed by a concurrent call), or no such school. Either way: nothing to do.
    return json({ sent: false, reason: "already_sent_or_unknown_school" });
  }

  const release = async () => {
    // Only undo OUR claim (matching timestamp), never someone else's.
    const { error } = await db
      .from("schools")
      .update({ welcome_email_sent_at: null })
      .eq("id", schoolId)
      .eq("welcome_email_sent_at", claimedAt);
    if (error) console.error("send-school-welcome: could not release claim", error.code);
  };

  const to = String(claimed.email ?? "").trim();
  if (!EMAIL_RE.test(to)) {
    await release();
    return json({ error: "The school has no valid email address on file." }, 422);
  }

  try {
    const { subject, text, html } = renderSchoolWelcomeEmail({ schoolName: claimed.name });
    await getEmailProvider().send(to, subject, text, undefined, undefined, { html });
    return json({ sent: true });
  } catch (err) {
    await release();
    console.error("send-school-welcome: provider failed", err instanceof Error ? err.message : String(err));
    return json({ error: "The welcome email could not be sent." }, 502);
  }
});
