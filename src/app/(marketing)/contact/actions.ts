"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRealClientIp } from "@/lib/get-real-client-ip";
import { sendSecurityAlert } from "@/lib/security-alert";
import { markIncompleteLeadCompleted } from "@/lib/marketing/demo-partial-store";
import { normalizeLeadEmail } from "@/lib/marketing/demo-partial";
import {
  isMissingColumnError,
  legacyAttributionColumns,
  parseAttributionFormData,
} from "@/lib/marketing/attribution-fields";
import { WHATSAPP_CONSENT_LABEL, buildStoredMessage, parseDemoRequest } from "@/lib/marketing/demo-request";

export type DemoRequestState = {
  status: "idle" | "success" | "error";
  message?: string;
  /** Which form field a validation error refers to, so the UI can focus it. Never user data. */
  field?: string;
};

// A visitor who retries (double tap, slow connection, second tab) must not create a second
// lead. An identical phone + school within this window is treated as the same request. This is
// checked against what is actually stored, so a request that failed to save is never swallowed.
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

// Simple, dependency-free bot mitigation for this public unauthenticated
// insert endpoint -- no CAPTCHA/third-party service, since those add a
// dependency and a privacy trade-off this form doesn't clearly need yet.
// Covers the two cheapest classes of abuse (naive form-fillers, scripted
// submits with no render delay) without adding friction for real visitors.
const MIN_FILL_TIME_MS = 1500;

// Inserts into public.marketing_demo_requests, a table isolated from the
// app's tenant schema (see the Phase 8 migration). This never touches any
// product/school data.
//
// The insert runs through the service-role admin client, not the anon-keyed
// client, so the table no longer needs a public INSERT policy: the abuse
// guards above (honeypot, fill-time, per-IP rate limit) are enforced here in
// the server action, which is the only legitimate writer. This lets the
// anon/authenticated insert policy be dropped in a follow-up migration.
export async function submitDemoRequest(
  _prevState: DemoRequestState,
  formData: FormData,
): Promise<DemoRequestState> {
  // Honeypot: real visitors never see or fill this field. If it's non-empty,
  // silently report success without writing anything, so a bot gets no
  // signal that it was caught and doesn't retry with adjusted behavior.
  const honeypot = String(formData.get("company_website") ?? "").trim();
  if (honeypot) {
    return { status: "success" };
  }

  const renderedAt = Number(formData.get("rendered_at") ?? 0);
  if (renderedAt && Date.now() - renderedAt < MIN_FILL_TIME_MS) {
    return { status: "success" };
  }

  // Marketing attribution (UTM tags and, for Google Ads clicks, the click ID),
  // forwarded silently from the form's hidden fields (see src/lib/attribution.ts)
  // -- never visitor-entered, so no validation beyond trimming/length-capping
  // (and a token-shape check on click IDs) and treating "" as "not provided".
  // Safe to trust loosely: these values only ever inform which channel gets
  // credit for a lead, they never gate submission or touch any other table.
  const attribution = parseAttributionFormData(formData);

  // All field rules (required fields, role whitelist, phone plausibility, contact method,
  // preferred date window, length caps, control-character stripping) live in one shared module
  // so the browser, this action and the tests agree. Runs before any database call.
  const parsed = parseDemoRequest(formData);
  if (!parsed.ok) {
    return { status: "error", message: parsed.message, field: parsed.field };
  }
  const input = parsed.value;

  // Abuse guard: the honeypot and minimum-fill-time checks above only deter
  // unsophisticated bots -- both signals are client-supplied, so a deliberate
  // attacker can trivially bypass either. Worst case without a real limit is
  // spam rows in marketing_demo_requests (isolated, insert-only-RLS, no
  // tenant/auth exposure) -- but that's still a real nuisance for whoever
  // reviews demo requests. Same increment_and_check_rate_limit() primitive
  // signUpSchool() and the public apply form already use, called via the
  // admin client since the function is revoked from anon/authenticated.
  // Keyed by IP, generous enough for a shared office/cybercafé connection
  // but well below what a script spamming the form would need.
  // SECURITY: use the last (trusted, edge-appended) X-Forwarded-For entry,
  // not the first (caller-controlled) -- see getRealClientIp.ts.
  const forwardedFor = (await headers()).get("x-forwarded-for");
  const clientIp = getRealClientIp(forwardedFor);
  const admin = createAdminClient();
  const { data: withinLimit } = await admin.rpc("increment_and_check_rate_limit", {
    p_bucket: `demo-request:${clientIp}`,
    p_max_events: 5,
    p_window_seconds: 3600,
  });
  if (withinLimit === false) {
    void sendSecurityAlert("Demo-request rate limit tripped", {
      limit: "per-IP (5/hr)",
      ip: clientIp,
    });
    return {
      status: "error",
      message: "Too many requests from this network. Please try again later, or email us directly.",
    };
  }

  // No tagSentryRequestContext() call here: this is a public unauthenticated insert endpoint (see
  // the comment above) -- there is never a session to tag, so the call would be a guaranteed
  // no-op every time.
  // Existing columns only: contact method and preferred time are written into `message` (see
  // the note at the top of src/lib/marketing/demo-request.ts), so no schema change is needed and
  // the admin console, new-lead email and assignment email show them as they are.
  const lead = {
    name: input.name,
    school_name: input.schoolName,
    role: input.role,
    email: input.email,
    phone: input.phone,
    student_count: input.studentCount,
    message: buildStoredMessage(input),
  };

  // Duplicate guard. Fail open: if this lookup errors we still save the lead, because a
  // duplicate row is far cheaper than a lost one.
  const { data: recent, error: recentError } = await admin
    .from("marketing_demo_requests")
    .select("id")
    .eq("phone", lead.phone)
    .eq("school_name", lead.school_name)
    .gte("created_at", new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString())
    .limit(1);
  if (!recentError && recent && recent.length > 0) {
    await markIncompleteLeadCompleted(admin, normalizeLeadEmail(input.email));
    return { status: "success" };
  }

  // The id is chosen here (the column accepts one) so the WhatsApp agreement below can point at this request.
  const leadId = crypto.randomUUID();
  let { error } = await admin
    .from("marketing_demo_requests")
    .insert({ id: leadId, ...lead, ...attribution });
  if (isMissingColumnError(error)) {
    // The extra attribution columns come from a migration the deploy workflow
    // applies in parallel with the app deploy. If the code is briefly live
    // first, keep the lead (with the three original UTM columns) rather than
    // failing the visitor's submission.
    ({ error } = await admin
      .from("marketing_demo_requests")
      .insert({ id: leadId, ...lead, ...legacyAttributionColumns(attribution) }));
  }

  if (error) {
    return {
      status: "error",
      message: "Something went wrong on our end. Please try again, or email us directly.",
    };
  }

  // The visitor ticked the WhatsApp tick-box: record the agreement with the exact words they saw. Best effort and
  // after the lead is safely saved: if it fails (or the table is not there yet during a deploy) the lead is unaffected
  // and a team member can record the agreement by hand. Never throws, never changes the visitor's result.
  if (input.whatsappConsent) {
    try {
      await admin.rpc("record_demo_whatsapp_consent", {
        p_demo_request_id: leadId,
        p_name: input.name,
        p_school_name: input.schoolName,
        p_phone: input.phone,
        p_consent_text: WHATSAPP_CONSENT_LABEL,
      });
    } catch {
      // intentionally ignored: see above
    }
  }

  // The visitor finished the form: close out any step-1 lead saved for this email (see
  // partial-lead-actions.ts) so it no longer shows as "started but didn't finish".
  await markIncompleteLeadCompleted(admin, normalizeLeadEmail(input.email));

  return { status: "success" };
}
