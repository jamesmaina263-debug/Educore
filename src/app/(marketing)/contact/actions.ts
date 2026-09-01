"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRealClientIp } from "@/lib/get-real-client-ip";

export type DemoRequestState = {
  status: "idle" | "success" | "error";
  message?: string;
};

// Simple, dependency-free bot mitigation for this public unauthenticated
// insert endpoint -- no CAPTCHA/third-party service, since those add a
// dependency and a privacy trade-off this form doesn't clearly need yet.
// Covers the two cheapest classes of abuse (naive form-fillers, scripted
// submits with no render delay) without adding friction for real visitors.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_FILL_TIME_MS = 1500;

// Inserts into public.marketing_demo_requests, a table isolated from the
// app's tenant schema with insert-only RLS (see the Phase 8 migration).
// This never touches any product/school data, and this file does not
// modify src/lib/supabase/server.ts -- it only imports the existing,
// already-shared createClient() helper the rest of the app also uses.
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

  const name = String(formData.get("name") ?? "").trim();
  const schoolName = String(formData.get("school_name") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const studentCountRaw = String(formData.get("student_count") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  // Marketing attribution, forwarded silently from the form's hidden fields
  // (see src/lib/attribution.ts) -- never visitor-entered, so no validation
  // beyond trimming/length-capping and treating "" as "not provided". Safe
  // to trust loosely: these values only ever inform which channel gets
  // credit for a lead, they never gate submission or touch any other table.
  const utmSource = String(formData.get("utm_source") ?? "").trim().slice(0, 100) || null;
  const utmMedium = String(formData.get("utm_medium") ?? "").trim().slice(0, 100) || null;
  const utmCampaign = String(formData.get("utm_campaign") ?? "").trim().slice(0, 100) || null;

  if (!name || !schoolName || !role || !email) {
    return {
      status: "error",
      message: "Name, school, role, and email are required.",
    };
  }

  if (!EMAIL_RE.test(email)) {
    return { status: "error", message: "Enter a valid email address." };
  }

  const studentCount = studentCountRaw ? Number(studentCountRaw) : null;
  if (studentCount !== null && (!Number.isFinite(studentCount) || studentCount < 0)) {
    return { status: "error", message: "Student count must be a positive number." };
  }

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
    return {
      status: "error",
      message: "Too many requests from this network. Please try again later, or email us directly.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("marketing_demo_requests").insert({
    name,
    school_name: schoolName,
    role,
    email,
    phone: phone || null,
    student_count: studentCount,
    message: message || null,
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
  });

  if (error) {
    return {
      status: "error",
      message: "Something went wrong on our end. Please try again, or email us directly.",
    };
  }

  return { status: "success" };
}
