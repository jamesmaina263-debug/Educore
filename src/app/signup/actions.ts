"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site";
import { cleanSignupText, toE164 } from "@/lib/signup-fields";
import { slugify } from "@/lib/slug";
import { getRealClientIp } from "@/lib/get-real-client-ip";
import { sendSecurityAlert } from "@/lib/security-alert";
import { generateTemporaryPassword } from "@/lib/temporary-password";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { parseAttributionFormData } from "@/lib/marketing/attribution-fields";
import {
  isValidTitle,
  isValidSchoolType,
  isValidStartingYear,
} from "@/lib/institution-reference-data";

export type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_per_student_kes: number;
  billing_period: string;
};

/**
 * The redesigned signup form has no plan-selection step (not in the
 * screenshot spec) — every self-signup starts the free trial on the Starter
 * plan. An admin can move the school to a different plan later from
 * Settings > Billing.
 *
 * This used to pick "the cheapest active plan", which only worked while the
 * three plans had different prices. Pricing is now a flat KES 100 per student
 * across all tiers, so ordering by price alone would tie and could return any
 * of them. Starter is therefore selected by code, with the old cheapest-plan
 * lookup kept only as a fallback if that row is ever renamed or deactivated.
 */
const TRIAL_PLAN_CODE = "starter";

async function getTrialPlan(
  adminClient: ReturnType<typeof createAdminClient>,
): Promise<Plan | null> {
  const columns = "id, code, name, description, price_per_student_kes, billing_period";

  const { data: starter } = await adminClient
    .from("subscription_plans")
    .select(columns)
    .eq("is_active", true)
    .eq("code", TRIAL_PLAN_CODE)
    .maybeSingle();
  if (starter) return starter;

  const { data } = await adminClient
    .from("subscription_plans")
    .select(columns)
    .eq("is_active", true)
    .order("price_per_student_kes", { ascending: true })
    .order("max_students", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export type SignupState = {
  error: string | null;
  success?: boolean;
  honeypot?: boolean;
  schoolName?: string;
  email?: string;
  /** False when the account was created but the set-password email could not be sent. */
  emailSent?: boolean;
};

// Profile defaults for a Kenyan self-serve signup. Nothing in the app reads these after signup
// except currency_code (a print page), and they stay editable by the school later, so they are
// not asked for up front. Everything else in the old long form was optional or unused.
const DEFAULT_COUNTRY = "KE";
const DEFAULT_CURRENCY = "KES";
const DEFAULT_TIMEZONE = "Africa/Nairobi";

function nairobiYear(): number {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).getUTCFullYear();
}

export async function signUpSchool(
  _prevState: SignupState,
  formData: FormData,
): Promise<SignupState> {
  // Honeypot: a bot that fills every field gets a convincing fake success and no account.
  if (cleanSignupText(formData.get("company_website"), 200)) {
    return { error: null, success: true, honeypot: true, schoolName: "—", email: "—", emailSent: true };
  }

  const loadedAtRaw = Number(formData.get("form_loaded_at") ?? 0);
  if (loadedAtRaw && Date.now() - loadedAtRaw < 2500) {
    return { error: "Please take a moment to review your details before submitting." };
  }

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Signup is not configured yet." };
  }

  const requestHeaders = await headers();
  const clientIp = getRealClientIp(requestHeaders.get("x-forwarded-for"));

  const { data: withinLimit } = await adminClient.rpc("increment_and_check_rate_limit", {
    p_bucket: `signup:${clientIp}`,
    p_max_events: 5,
    p_window_seconds: 3600,
  });
  if (withinLimit === false) {
    void sendSecurityAlert("Signup rate limit tripped", {
      limit: "per-IP (5/hr)",
      ip: clientIp,
    });
    return { error: "Too many signup attempts from this network. Please try again later." };
  }

  const captchaToken = cleanSignupText(formData.get("cf-turnstile-response"), 4096);
  const captchaOk = await verifyTurnstileToken(captchaToken, clientIp);
  if (!captchaOk) {
    return { error: "CAPTCHA verification failed. Please try again." };
  }

  // Required: who you are, your school, and how to reach you.
  const ownerName = cleanSignupText(formData.get("owner_name"), 120);
  const schoolName = cleanSignupText(formData.get("school_name"), 200);
  const phoneRaw = cleanSignupText(formData.get("phone"), 40);
  const email = cleanSignupText(formData.get("email"), 254).toLowerCase();

  const missing: string[] = [];
  if (!ownerName) missing.push("Your name");
  if (!schoolName) missing.push("School name");
  if (!phoneRaw) missing.push("Phone");
  if (!email) missing.push("Email");
  if (missing.length > 0) {
    return { error: `Please fill in: ${missing.join(", ")}.` };
  }

  const phone = toE164(phoneRaw);
  if (!phone) {
    return { error: "Enter a valid phone number, e.g. 0712 345 678 or +254 712 345 678." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Please enter a valid email address." };
  }

  // Optional extras; when provided they are still validated against the reference lists.
  const title = cleanSignupText(formData.get("title"), 40);
  const schoolType = cleanSignupText(formData.get("school_type"), 60);
  const address = cleanSignupText(formData.get("address"), 300);
  if (title && !isValidTitle(title)) return { error: "Please select a valid title." };
  if (schoolType && !isValidSchoolType(schoolType)) return { error: "Please select a valid school type." };

  const plan = await getTrialPlan(adminClient);
  if (!plan) {
    return { error: "Signup is temporarily unavailable — no active plan is configured. Please contact support." };
  }

  // The password is random and never shown or sent to anyone: the owner sets their own through
  // the emailed link below, which also proves they control the address. (Previously a temporary
  // password was displayed on screen, so anyone could open a trial under someone else's email.)
  const { data: created, error: userError } = await adminClient.auth.admin.createUser({
    email,
    password: generateTemporaryPassword(),
    email_confirm: true,
  });
  if (userError || !created.user) {
    if (userError && /already|registered|exists/i.test(userError.message)) {
      return {
        error:
          "An account with this email already exists. Sign in, or use “Forgot password” on the sign-in page to set a new password.",
      };
    }
    return { error: userError?.message ?? "Could not create your account." };
  }

  const slug = `${slugify(schoolName)}-${created.user.id.slice(0, 6)}`;
  const startingYear = nairobiYear();
  const { data: school, error: schoolError } = await adminClient
    .from("schools")
    .insert({
      name: schoolName,
      slug,
      status: "trial",
      school_type: schoolType || null,
      phone,
      email,
      address: address || null,
      country_code: DEFAULT_COUNTRY,
      currency_code: DEFAULT_CURRENCY,
      gmt_timezone: DEFAULT_TIMEZONE,
      starting_academic_year: isValidStartingYear(startingYear) ? startingYear : null,
    })
    .select("id")
    .single();
  if (schoolError || !school) {
    await adminClient.auth.admin.deleteUser(created.user.id);
    return { error: schoolError?.message ?? "Could not create the school." };
  }

  const { data: ownerRole } = await adminClient
    .from("roles")
    .select("id")
    .eq("name", "school_owner")
    .single();
  if (!ownerRole) {
    await adminClient.from("schools").delete().eq("id", school.id);
    await adminClient.auth.admin.deleteUser(created.user.id);
    return { error: "Owner role is not configured — contact support." };
  }

  const { error: linkError } = await adminClient.from("school_users").insert({
    auth_user_id: created.user.id,
    school_id: school.id,
    role_id: ownerRole.id,
    title: title || null,
    full_name: ownerName,
    email,
    phone,
    status: "active",
    // The owner chooses their own password via the emailed link, so there is no temporary
    // password to force a change of.
    must_change_password: false,
    temp_password_expires_at: null,
  });
  if (linkError) {
    await adminClient.from("schools").delete().eq("id", school.id);
    await adminClient.auth.admin.deleteUser(created.user.id);
    return { error: linkError.message };
  }

  const { error: trialError } = await adminClient.rpc("start_trial_subscription", {
    p_school_id: school.id,
    p_plan_id: plan.id,
    p_trial_days: 30,
  });
  if (trialError) {
    await adminClient.from("school_users").delete().eq("auth_user_id", created.user.id);
    await adminClient.from("schools").delete().eq("id", school.id);
    await adminClient.auth.admin.deleteUser(created.user.id);
    return { error: trialError.message };
  }

  // Marketing attribution is best-effort and must never affect the signup itself.
  try {
    const attribution = parseAttributionFormData(formData);
    if (Object.values(attribution).some((v) => v !== null)) {
      const { error: attributionError } = await adminClient
        .from("marketing_signup_attribution")
        .insert({ school_id: school.id, ...attribution });
      if (attributionError) {
        console.warn("signup attribution not stored", attributionError.code);
      }
    }
  } catch (e) {
    console.warn("signup attribution not stored", e instanceof Error ? e.message : e);
  }

  // Same mechanism and redirect as the existing "Forgot password" page: the link lands on
  // /auth/confirm, which signs the owner in, then /reset-password, which sets the password and
  // sends them to /dashboard. If sending fails the account still exists, so say so plainly
  // instead of leaving the owner stuck (they can request the same email from Forgot password).
  const origin =
    requestHeaders.get("origin") ??
    (requestHeaders.get("host") ? `https://${requestHeaders.get("host")}` : null) ??
    SITE_URL;
  let emailSent = true;
  try {
    const supabase = await createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/confirm?next=/reset-password`,
    });
    if (resetError) {
      emailSent = false;
      console.error("signup: set-password email failed", resetError.status ?? resetError.code);
    }
  } catch (e) {
    emailSent = false;
    console.error("signup: set-password email threw", e instanceof Error ? e.message : e);
  }

  return { error: null, success: true, schoolName, email, emailSent };
}
