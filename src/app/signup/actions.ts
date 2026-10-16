"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site";
import { toE164 } from "@/lib/signup-fields";
import { slugify } from "@/lib/slug";
import { getRealClientIp } from "@/lib/get-real-client-ip";
import { sendSecurityAlert } from "@/lib/security-alert";
import { safeStorageFilename } from "@/lib/storage-path";
import { generateTemporaryPassword } from "@/lib/temporary-password";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { parseAttributionFormData } from "@/lib/marketing/attribution-fields";
import {
  isValidTitle,
  isValidSchoolType,
  isValidCycle,
  isValidOwnershipType,
  isValidInstitutionType,
  isValidCountryCode,
  isValidCurrencyCode,
  isValidStartingYear,
  timezoneOptions,
  startingYearOptions,
  defaultsForCountry,
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
  // Set only by the honeypot branch below. success is true (so bots see a
  // convincing fake success screen and don't retry) but no account was
  // actually created -- callers that treat success as a conversion signal
  // (e.g. the sign_up GTM event in signup-form.tsx) must check this and
  // skip firing when it's true.
  honeypot?: boolean;
  schoolName?: string;
  email?: string;
  /** False when the account was created but the set-password email could not be sent. */
  emailSent?: boolean;
};

const URL_FIELDS = [
  ["website", "Website"],
  ["facebook_url", "Facebook"],
  ["twitter_url", "Twitter"],
  ["instagram_url", "Instagram"],
  ["youtube_url", "YouTube"],
  ["cloud_folder_url", "Cloud Folder"],
] as const;

// Loose but real E.164-ish check — the form now serves any country, not
// just Kenya, so this can't be as strict as the guardian-phone regex in
// apply/[slug]/actions.ts.
const PHONE_RE = /^\+?[1-9]\d{7,14}$/;

function trimmed(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function signUpSchool(
  _prevState: SignupState,
  formData: FormData,
): Promise<SignupState> {
  // Honeypot: a real applicant never fills this hidden field in.
  const honeypot = trimmed(formData, "company_website");
  if (honeypot) {
    return { error: null, success: true, honeypot: true, schoolName: "—", email: "—", emailSent: true };
  }

  // Minimum-fill-time check, same convention as apply/[slug]/actions.ts.
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

  // SECURITY: use the last (trusted, edge-appended) X-Forwarded-For entry,
  // not the first (caller-controlled) -- see getRealClientIp.ts.
  const forwardedFor = (await headers()).get("x-forwarded-for");
  const clientIp = getRealClientIp(forwardedFor);

  // Abuse guard — this endpoint is public/unauthenticated and a successful
  // call creates a real Supabase Auth user + school + trial subscription +
  // storage write. Same rate-limit primitive/limits as before.
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

  // Mandatory CAPTCHA check — before touching the database at all.
  const captchaToken = trimmed(formData, "cf-turnstile-response");
  const captchaOk = await verifyTurnstileToken(captchaToken, clientIp);
  if (!captchaOk) {
    return { error: "CAPTCHA verification failed. Please try again." };
  }

  // ---- Field extraction ----
  const title = trimmed(formData, "title");
  const ownerName = trimmed(formData, "owner_name");
  const schoolType = trimmed(formData, "school_type");

  const schoolName = trimmed(formData, "school_name");
  const description = trimmed(formData, "description");
  const cycleType = trimmed(formData, "cycle_type");
  const ownershipType = trimmed(formData, "ownership_type");
  const institutionType = trimmed(formData, "institution_type");
  const phoneInput = trimmed(formData, "phone");
  const email = trimmed(formData, "email");
  const countryCode = trimmed(formData, "country_code");
  const address = trimmed(formData, "address");
  const startingAcademicYearRaw = trimmed(formData, "starting_academic_year");
  const gmtTimezoneRaw = trimmed(formData, "gmt_timezone");
  const currencyCodeRaw = trimmed(formData, "currency_code");

  const website = trimmed(formData, "website");
  const facebookUrl = trimmed(formData, "facebook_url");
  const twitterUrl = trimmed(formData, "twitter_url");
  const instagramUrl = trimmed(formData, "instagram_url");
  const youtubeUrl = trimmed(formData, "youtube_url");
  const cloudFolderUrl = trimmed(formData, "cloud_folder_url");

  const logoFile = formData.get("logo");

  // ---- Required-field validation ----
  // The signup form was cut down to the fields needed to create an account
  // (name, school name, email, phone, country). Everything else is optional:
  // when omitted, the school columns are left null (all nullable, and every
  // reader already handles null) except year/currency/time zone, which get
  // sensible defaults derived from the country. The longer fields are still
  // accepted and validated if a client sends them.
  const missing: string[] = [];
  if (!ownerName) missing.push("Your Name");
  if (!schoolName) missing.push("Institution Name");
  if (!phoneInput) missing.push("Phone");
  if (!email) missing.push("Email");
  if (!countryCode) missing.push("Country");
  if (missing.length > 0) {
    return { error: `Please fill in: ${missing.join(", ")}.` };
  }

  // ---- Value validation (never trust the client Select options) ----
  if (!isValidCountryCode(countryCode)) return { error: "Please select a valid country." };
  if (title && !isValidTitle(title)) return { error: "Please select a valid title." };
  if (schoolType && !isValidSchoolType(schoolType)) return { error: "Please select a valid school type." };
  if (cycleType && !isValidCycle(cycleType)) return { error: "Please select a valid cycle." };
  if (ownershipType && !isValidOwnershipType(ownershipType)) return { error: "Please select a valid organisation state." };
  if (institutionType && !isValidInstitutionType(institutionType)) return { error: "Please select a valid institution type." };
  if (currencyCodeRaw && !isValidCurrencyCode(currencyCodeRaw)) return { error: "Please select a valid currency code." };
  if (gmtTimezoneRaw && !timezoneOptions().includes(gmtTimezoneRaw)) return { error: "Please select a valid time zone." };
  let startingAcademicYear = startingYearOptions()[0];
  if (startingAcademicYearRaw) {
    startingAcademicYear = Number(startingAcademicYearRaw);
    if (!Number.isInteger(startingAcademicYear) || !isValidStartingYear(startingAcademicYear)) {
      return { error: "Please select a valid year." };
    }
  }
  const countryDefaults = defaultsForCountry(countryCode);
  const currencyCode = currencyCodeRaw || countryDefaults.currencyCode;
  const gmtTimezone = gmtTimezoneRaw || countryDefaults.gmtTimezone;
  // Accepts the way Kenyans actually type numbers (0712 345 678 -> +254712345678) as well as
  // everything the previous rule accepted, so no number that worked before is rejected now.
  const phone = toE164(phoneInput) ?? (PHONE_RE.test(phoneInput) ? phoneInput : null);
  if (!phone) {
    return { error: "Please enter a valid phone number, e.g. 0712 345 678 or +254 712 345 678." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Please enter a valid email address." };
  }

  const urlValues: Record<string, string> = {
    website,
    facebook_url: facebookUrl,
    twitter_url: twitterUrl,
    instagram_url: instagramUrl,
    youtube_url: youtubeUrl,
    cloud_folder_url: cloudFolderUrl,
  };
  for (const [key, label] of URL_FIELDS) {
    const value = urlValues[key];
    if (!value) continue; // all optional
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("bad protocol");
    } catch {
      return { error: `Please enter a valid ${label} URL, or leave it blank.` };
    }
  }

  let logoToUpload: File | null = null;
  if (logoFile instanceof File && logoFile.size > 0) {
    const MAX_LOGO_BYTES = 2 * 1024 * 1024; // matches the school-logos bucket's file_size_limit
    // SVG is deliberately excluded: it can carry script, and logos are served from a public bucket.
    const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
    if (logoFile.size > MAX_LOGO_BYTES) {
      return { error: "Logo must be 2MB or smaller." };
    }
    if (!ALLOWED_LOGO_TYPES.includes(logoFile.type)) {
      return { error: "Logo must be a PNG, JPEG, or WebP image." };
    }
    logoToUpload = logoFile;
  }

  // ---- Plan (auto-assigned — see getTrialPlan above) ----
  const plan = await getTrialPlan(adminClient);
  if (!plan) {
    return { error: "Signup is temporarily unavailable — no active plan is configured. Please contact support." };
  }

  // ---- 1. Owner auth account, with a generated temporary password ----
  // (chosen over asking the signer to pick one, since the screenshot spec
  // has no password field — the same must_change_password convention
  // src/app/(app)/settings/actions.ts already uses for staff invites).
  // The password is random and never shown or sent to anyone: the owner sets their own through
  // the emailed link below, which also proves they control this address. (It used to be
  // displayed on screen, so anyone could open a trial under someone else's email.)
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

  // ---- 2. The school itself, trialing from day one ----
  const baseSlug = slugify(schoolName);
  const slug = `${baseSlug}-${created.user.id.slice(0, 6)}`;
  const { data: school, error: schoolError } = await adminClient
    .from("schools")
    .insert({
      name: schoolName,
      slug,
      status: "trial",
      description: description || null,
      school_type: schoolType || null,
      cycle_type: cycleType || null,
      ownership_type: ownershipType || null,
      institution_type: institutionType || null,
      phone,
      email,
      country_code: countryCode,
      address: address || null,
      starting_academic_year: startingAcademicYear,
      gmt_timezone: gmtTimezone,
      currency_code: currencyCode,
      website: website || null,
      facebook_url: facebookUrl || null,
      twitter_url: twitterUrl || null,
      instagram_url: instagramUrl || null,
      youtube_url: youtubeUrl || null,
      cloud_folder_url: cloudFolderUrl || null,
    })
    .select("id")
    .single();
  if (schoolError || !school) {
    await adminClient.auth.admin.deleteUser(created.user.id);
    return { error: schoolError?.message ?? "Could not create the school." };
  }

  // ---- 3. Owner's school_users row ----
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
    // A phone number can belong to only one active account across the whole platform
    // (uq_school_users_active_phone). Never show the raw Postgres error to the visitor.
    if (linkError.code === "23505" || /uq_school_users_active_phone/.test(linkError.message)) {
      return {
        error:
          "This phone number is already registered to another account. Use a different number, or sign in if it is yours.",
      };
    }
    return { error: linkError.message };
  }

  // ---- 4. Start the trial ----
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

  // ---- 4b. Marketing attribution (best-effort — never fails the signup) ----
  // Which ad/campaign brought this school in, so a paying customer can later
  // be traced to the Google Ads click (gclid) and reported back as a
  // conversion. Written to its own isolated table, after the school is fully
  // created, so nothing here can affect signup: a missing table (migration not
  // applied yet), a database error, or no attribution at all is simply skipped.
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

  // ---- 5. Logo upload (optional, best-effort — never fails the signup) ----
  if (logoToUpload) {
    const path = `${school.id}/logo-${Date.now()}-${safeStorageFilename(logoToUpload.name)}`;
    const { error: uploadError } = await adminClient.storage
      .from("school-logos")
      .upload(path, logoToUpload, { contentType: logoToUpload.type });
    if (!uploadError) {
      const { data: publicUrlData } = adminClient.storage.from("school-logos").getPublicUrl(path);
      await adminClient.from("schools").update({ logo_url: publicUrlData.publicUrl }).eq("id", school.id);
    }
  }

  // ---- 6. Set-password email ----
  // Same mechanism and redirect as the "Forgot password" page: the link lands on /auth/confirm,
  // which signs the owner in, then /reset-password, which sets their password and sends them to
  // /dashboard. If sending fails the account still exists, so say so plainly instead of leaving
  // the owner stuck (they can request the same email from Forgot password).
  const requestHeaders = await headers();
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

  return {
    error: null,
    success: true,
    schoolName,
    email,
    emailSent,
  };
}
