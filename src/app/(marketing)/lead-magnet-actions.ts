"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRealClientIp } from "@/lib/get-real-client-ip";
import { sendSecurityAlert } from "@/lib/security-alert";

export type LeadMagnetState = {
  status: "idle" | "success" | "error";
  message?: string;
};

// Same dependency-free bot mitigation as submitDemoRequest (contact/actions.ts)
// -- honeypot + minimum fill-time, no CAPTCHA. This form asks for even less
// (just an email), so the same reasoning applies with even less to lose.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_FILL_TIME_MS = 1000;

// Inserts into public.marketing_leads (20260919131500_marketing_leads.sql),
// isolated from the tenant schema exactly like marketing_demo_requests --
// insert-only RLS, no foreign keys into product data, super-admin-only read.
export async function submitLeadMagnet(
  _prevState: LeadMagnetState,
  formData: FormData,
): Promise<LeadMagnetState> {
  const honeypot = String(formData.get("company_website") ?? "").trim();
  if (honeypot) {
    return { status: "success" };
  }

  const renderedAt = Number(formData.get("rendered_at") ?? 0);
  if (renderedAt && Date.now() - renderedAt < MIN_FILL_TIME_MS) {
    return { status: "success" };
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const resource = String(formData.get("resource") ?? "").trim() || "cbc_digital_readiness_checklist";
  const sourcePage = String(formData.get("source_page") ?? "").trim().slice(0, 200) || null;
  const utmSource = String(formData.get("utm_source") ?? "").trim().slice(0, 100) || null;
  const utmMedium = String(formData.get("utm_medium") ?? "").trim().slice(0, 100) || null;
  const utmCampaign = String(formData.get("utm_campaign") ?? "").trim().slice(0, 100) || null;

  if (!email) {
    return { status: "error", message: "Enter your email address." };
  }
  if (!EMAIL_RE.test(email)) {
    return { status: "error", message: "Enter a valid email address." };
  }

  // Same rate-limit primitive and reasoning as submitDemoRequest: the
  // honeypot/fill-time checks only deter unsophisticated bots, so a real
  // floor is still needed. A distinct bucket from demo-request means a
  // burst on one form doesn't consume the other's allowance. Slightly
  // higher ceiling than the demo form (8 vs 5) since a lower-friction,
  // lower-intent form is more likely to see a legitimate quick retry
  // (e.g. a typo'd email resubmitted).
  const forwardedFor = (await headers()).get("x-forwarded-for");
  const clientIp = getRealClientIp(forwardedFor);
  const admin = createAdminClient();
  const { data: withinLimit } = await admin.rpc("increment_and_check_rate_limit", {
    p_bucket: `lead-magnet:${clientIp}`,
    p_max_events: 8,
    p_window_seconds: 3600,
  });
  if (withinLimit === false) {
    void sendSecurityAlert("Lead-magnet rate limit tripped", {
      limit: "per-IP (8/hr)",
      ip: clientIp,
    });
    return {
      status: "error",
      message: "Too many requests from this network. Please try again later.",
    };
  }

  const supabase = await createClient();
  // onConflict against the unique constraint on email (lowercased above): a
  // visitor who resubmits (cleared storage, different browser) gets the
  // same success response and their download, without a constraint-
  // violation error surfacing, and without a duplicate row.
  const { error } = await supabase
    .from("marketing_leads")
    .upsert(
      {
        email,
        resource,
        source_page: sourcePage,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
      },
      { onConflict: "email", ignoreDuplicates: true },
    );

  if (error) {
    return {
      status: "error",
      message: "Something went wrong on our end. Please try again.",
    };
  }

  return { status: "success" };
}
