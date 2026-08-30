"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/slug";
import { safeStorageFilename } from "@/lib/storage-path";
import { generateTemporaryPassword, temporaryPasswordExpiry } from "@/lib/temporary-password";
import { verifyTurnstileToken } from "@/lib/turnstile";
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
 * screenshot spec) — every self-signup starts on the cheapest active plan,
 * same trial terms as before. An admin can move the school to a different
 * plan later from Settings > Billing.
 */
async function getCheapestActivePlan(
  adminClient: ReturnType<typeof createAdminClient>,
): Promise<Plan | null> {
  const { data } = await adminClient
    .from("subscription_plans")
    .select("id, code, name, description, price_per_student_kes, billing_period")
    .eq("is_active", true)
    .order("price_per_student_kes", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export type SignupState = {
  error: string | null;
  success?: boolean;
  schoolName?: string;
  email?: string;
  temporaryPassword?: string;
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
    return { error: null, success: true, schoolName: "—", email: "—", temporaryPassword: "—" };
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

  const forwardedFor = (await headers()).get("x-forwarded-for");
  const clientIp = forwardedFor?.split(",")[0]?.trim() || "unknown";

  // Abuse guard — this endpoint is public/unauthenticated and a successful
  // call creates a real Supabase Auth user + school + trial subscription +
  // storage write. Same rate-limit primitive/limits as before.
  const { data: withinLimit } = await adminClient.rpc("increment_and_check_rate_limit", {
    p_bucket: `signup:${clientIp}`,
    p_max_events: 5,
    p_window_seconds: 3600,
  });
  if (withinLimit === false) {
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
  const phone = trimmed(formData, "phone");
  const email = trimmed(formData, "email");
  const countryCode = trimmed(formData, "country_code");
  const address = trimmed(formData, "address");
  const startingAcademicYearRaw = trimmed(formData, "starting_academic_year");
  const gmtTimezone = trimmed(formData, "gmt_timezone");
  const currencyCode = trimmed(formData, "currency_code");

  const website = trimmed(formData, "website");
  const facebookUrl = trimmed(formData, "facebook_url");
  const twitterUrl = trimmed(formData, "twitter_url");
  const instagramUrl = trimmed(formData, "instagram_url");
  const youtubeUrl = trimmed(formData, "youtube_url");
  const cloudFolderUrl = trimmed(formData, "cloud_folder_url");

  const logoFile = formData.get("logo");

  // ---- Required-field validation ----
  const missing: string[] = [];
  if (!title) missing.push("Your Title");
  if (!ownerName) missing.push("Your Name");
  if (!schoolType) missing.push("School Type");
  if (!schoolName) missing.push("Institution Name");
  if (!description) missing.push("Institution Description");
  if (!cycleType) missing.push("Cycles");
  if (!ownershipType) missing.push("Organisation State");
  if (!institutionType) missing.push("Type");
  if (!phone) missing.push("Phone");
  if (!email) missing.push("Email");
  if (!countryCode) missing.push("Country");
  if (!address) missing.push("Address");
  if (!startingAcademicYearRaw) missing.push("Year");
  if (!gmtTimezone) missing.push("GMT Timezone");
  if (!currencyCode) missing.push("Currency Code");
  if (missing.length > 0) {
    return { error: `Please fill in: ${missing.join(", ")}.` };
  }

  // ---- Value validation (never trust the client Select options) ----
  if (!isValidTitle(title)) return { error: "Please select a valid title." };
  if (!isValidSchoolType(schoolType)) return { error: "Please select a valid school type." };
  if (!isValidCycle(cycleType)) return { error: "Please select a valid cycle." };
  if (!isValidOwnershipType(ownershipType)) return { error: "Please select a valid organisation state." };
  if (!isValidInstitutionType(institutionType)) return { error: "Please select a valid institution type." };
  if (!isValidCountryCode(countryCode)) return { error: "Please select a valid country." };
  if (!isValidCurrencyCode(currencyCode)) return { error: "Please select a valid currency code." };
  if (!timezoneOptions().includes(gmtTimezone)) return { error: "Please select a valid time zone." };
  const startingAcademicYear = Number(startingAcademicYearRaw);
  if (!Number.isInteger(startingAcademicYear) || !isValidStartingYear(startingAcademicYear)) {
    return { error: "Please select a valid year." };
  }
  if (!PHONE_RE.test(phone)) {
    return { error: "Please enter a valid phone number, e.g. +2547XXXXXXXX." };
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
    const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
    if (logoFile.size > MAX_LOGO_BYTES) {
      return { error: "Logo must be 2MB or smaller." };
    }
    if (!ALLOWED_LOGO_TYPES.includes(logoFile.type)) {
      return { error: "Logo must be a PNG, JPEG, WebP, or SVG image." };
    }
    logoToUpload = logoFile;
  }

  // ---- Plan (auto-assigned — see getCheapestActivePlan above) ----
  const plan = await getCheapestActivePlan(adminClient);
  if (!plan) {
    return { error: "Signup is temporarily unavailable — no active plan is configured. Please contact support." };
  }

  // ---- 1. Owner auth account, with a generated temporary password ----
  // (chosen over asking the signer to pick one, since the screenshot spec
  // has no password field — the same must_change_password convention
  // src/app/(app)/settings/actions.ts already uses for staff invites).
  const temporaryPassword = generateTemporaryPassword();
  const { data: created, error: userError } = await adminClient.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
  });
  if (userError || !created.user) {
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
      description,
      school_type: schoolType,
      cycle_type: cycleType,
      ownership_type: ownershipType,
      institution_type: institutionType,
      phone,
      email,
      country_code: countryCode,
      address,
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
    title,
    full_name: ownerName,
    email,
    phone,
    status: "active",
    must_change_password: true,
    temp_password_expires_at: temporaryPasswordExpiry(),
  });
  if (linkError) {
    await adminClient.from("schools").delete().eq("id", school.id);
    await adminClient.auth.admin.deleteUser(created.user.id);
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

  // No auto-sign-in: unlike the old password-the-user-chose flow, this
  // password is generated for them and needs to be shown once. Signing
  // them in here would redirect straight past that screen. They confirm it
  // and continue to /login from the success state instead.
  return {
    error: null,
    success: true,
    schoolName,
    email,
    temporaryPassword,
  };
}
