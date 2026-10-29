// Asks the send-school-welcome Edge Function to send the one-time "Welcome to EduCore Africa" email to a school
// that has just registered. This is a separate email from the set-password email (Supabase Auth sends that one).
//
// Best-effort by design: this NEVER throws and NEVER blocks registration. A missing secret, a network error, a
// timeout or a provider failure all come back as { sent: false } and are logged, and signup carries on exactly as
// before. The send-once guarantee lives in the function (an atomic claim on schools.welcome_email_sent_at), so
// calling this twice for the same school cannot produce two emails.
//
// The function reads the recipient and the school name from the database by school id; nothing here chooses who
// gets emailed.

export type WelcomeEmailResult = { sent: true } | { sent: false; reason: string };

// Kept short: signup is waiting on this call, and the welcome email is never worth a slow signup.
const WELCOME_TIMEOUT_MS = 6_000;

export async function sendSchoolWelcomeEmail(schoolId: string): Promise<WelcomeEmailResult> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secret = process.env.DISPATCH_SECRET;
    if (!baseUrl || !secret) {
      console.error("signup: welcome email skipped (DISPATCH_SECRET or NEXT_PUBLIC_SUPABASE_URL not configured)");
      return { sent: false, reason: "not_configured" };
    }

    const res = await fetch(`${baseUrl}/functions/v1/send-school-welcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-dispatch-secret": secret },
      body: JSON.stringify({ school_id: schoolId }),
      cache: "no-store",
      signal: AbortSignal.timeout(WELCOME_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { sent?: boolean; reason?: string; error?: string } | null;

    if (!res.ok) {
      console.error("signup: welcome email failed", res.status, body?.error ?? "");
      return { sent: false, reason: body?.error ?? `status_${res.status}` };
    }
    if (body?.sent === true) return { sent: true };
    return { sent: false, reason: body?.reason ?? "not_sent" };
  } catch (e) {
    console.error("signup: welcome email threw", e instanceof Error ? e.message : e);
    return { sent: false, reason: "request_failed" };
  }
}
