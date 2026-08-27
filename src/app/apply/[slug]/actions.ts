"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeStorageFilename } from "@/lib/storage-path";

const KENYA_PHONE_RE = /^\+254\d{9}$/;
const GUARDIAN_VERIFICATION_PURPOSE = "guardian_verification";

export type ApplyState = {
  error: string | null;
  success?: boolean;
  applicationNumber?: string;
  accessToken?: string;
  // Set when a submitted guardian phone matches an existing guardian account at the school.
  // Verification is entirely optional — the applicant can confirm with the code we texted, or
  // just submit anyway (e.g. no access to that phone right now, shared/borrowed number, etc.).
  // Nothing below this ever blocks the application from completing.
  needsGuardianVerification?: boolean;
  guardianVerificationPhone?: string;
  guardianVerificationNotice?: string | null;
};

export async function submitApplication(
  _prev: ApplyState,
  formData: FormData,
): Promise<ApplyState> {
  const slug = String(formData.get("school_slug") ?? "").trim();

  // Honeypot: a real applicant never fills this hidden field in. Bots that blindly fill every
  // input do. Reject silently-successful (don't tip off the bot) rather than with a visible error.
  const honeypot = String(formData.get("website") ?? "").trim();
  if (honeypot) {
    return { error: null, success: true, applicationNumber: "—", accessToken: "" };
  }

  // Minimum-fill-time check: a human takes at least a few seconds to fill this form; a scripted
  // bot typically submits near-instantly. formLoadedAt is a hidden field set client-side on mount.
  const loadedAtRaw = Number(formData.get("form_loaded_at") ?? 0);
  if (loadedAtRaw && Date.now() - loadedAtRaw < 2500) {
    return { error: "Please take a moment to review your details before submitting." };
  }

  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const otherNames = String(formData.get("other_names") ?? "").trim();
  const dateOfBirth = String(formData.get("date_of_birth") ?? "").trim();
  const gender = String(formData.get("gender") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  const guardianPhone = String(formData.get("guardian_phone") ?? "").trim();
  const guardianName = String(formData.get("guardian_name") ?? "").trim();
  const guardianEmail = String(formData.get("guardian_email") ?? "").trim();
  const relationship = String(formData.get("relationship") ?? "guardian").trim();

  if (!slug) return { error: "Missing school reference — please use the link the school gave you." };
  if (!firstName || !lastName || !dateOfBirth || !gender) {
    return { error: "Please fill in the student's name, date of birth, and gender." };
  }
  if (gender !== "male" && gender !== "female") {
    return { error: "Please select the student's gender." };
  }
  if (!guardianPhone || !guardianName) {
    return { error: "Please provide a parent/guardian phone number and name." };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Applications are not available right now." };
  }

  // Abuse guard: this endpoint is public/unauthenticated, and a successful submission
  // triggers a real SMS to guardianPhone (whatever number a caller supplies) plus a
  // storage write per uploaded document. The honeypot and minimum-fill-time checks above
  // only deter unsophisticated bots — nothing previously stopped a script from submitting
  // repeatedly with varying names/phone numbers, which would both run up real SMS costs
  // and could be used to send unsolicited "your child's application" texts to phone
  // numbers the sender doesn't own. Same increment_and_check_rate_limit() primitive
  // signUpSchool() and request-otp already use; keyed by IP, generous enough for a school
  // office or cybercafé submitting several walk-in applications from one connection.
  const forwardedFor = (await headers()).get("x-forwarded-for");
  const clientIp = forwardedFor?.split(",")[0]?.trim() || "unknown";
  const { data: withinLimit } = await admin.rpc("increment_and_check_rate_limit", {
    p_bucket: `apply-submit:${clientIp}`,
    p_max_events: 10,
    p_window_seconds: 3_600,
  });
  if (withinLimit === false) {
    return { error: "Too many applications submitted from this network. Please try again later." };
  }

  const { data: school, error: schoolError } = await admin
    .from("schools")
    .select("id, name, status, admission_response_note")
    .eq("slug", slug)
    .maybeSingle();
  if (schoolError || !school) {
    return { error: "We couldn't find this school. Please check the link and try again." };
  }
  if (school.status === "suspended" || school.status === "cancelled") {
    return { error: "This school is not accepting online applications at the moment." };
  }

  // Basic duplicate-submission guard: same guardian phone + same student name applied in the
  // last 24 hours. Not a hard uniqueness constraint (a real family could legitimately reapply
  // after being rejected/withdrawn), just a speed bump against accidental double-submits and bots.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentDuplicates } = await admin
    .from("applications")
    .select("id, guardian_id, school_users!applications_guardian_id_fkey(phone)")
    .eq("school_id", school.id)
    .eq("first_name", firstName)
    .eq("last_name", lastName)
    .gte("created_at", since);
  const alreadyApplied = (recentDuplicates ?? []).some((a) => {
    const guardian = a.school_users as unknown as { phone: string | null } | null;
    return guardian?.phone === guardianPhone;
  });
  if (alreadyApplied) {
    return {
      error:
        "It looks like this application was already submitted recently. The school will be in touch. If the school asked you to resubmit, please contact them directly.",
    };
  }

  // Find-or-create the guardian identity — admin-client version of lib/guardians.ts's
  // findOrCreateGuardian (that helper relies on auth_school_id(), which doesn't exist here since
  // nobody is signed in yet).
  let guardianId: string;
  let guardianIdentityVerified = true;
  const { data: existingGuardian } = await admin
    .from("school_users")
    .select("id, roles(name)")
    .eq("phone", guardianPhone)
    .eq("school_id", school.id)
    .maybeSingle();

  if (existingGuardian) {
    const roleName = (existingGuardian.roles as unknown as { name: string } | null)?.name;
    if (roleName !== "parent") {
      return { error: "This phone number is already registered under a different role at this school." };
    }
    guardianId = existingGuardian.id as string;

    // This phone belongs to an existing guardian account. Offer an optional OTP confirmation
    // before attaching this application to it, so a stranger who happens to know a parent's
    // number can't silently pin a fake application on their identity. This never blocks
    // submission — some applicants won't have access to that phone right now (shared/borrowed
    // number, etc.), or the school may be entering this for a parent without a smartphone —
    // "skip" and any failure to send a code both fall through to an unverified submission.
    const intent = String(formData.get("guardian_verification_intent") ?? "").trim();
    const otpCode = String(formData.get("guardian_otp_code") ?? "").trim();
    const canReceiveOtp = KENYA_PHONE_RE.test(guardianPhone);

    if (intent === "skip") {
      guardianIdentityVerified = false;
    } else if (intent === "verify" && canReceiveOtp) {
      if (!/^\d{6}$/.test(otpCode)) {
        return {
          error: null,
          needsGuardianVerification: true,
          guardianVerificationPhone: guardianPhone,
          guardianVerificationNotice: "Enter the 6-digit code, or submit without confirming.",
        };
      }
      const { data: isValid } = await admin.rpc("verify_otp", {
        p_phone: guardianPhone,
        p_code: otpCode,
        p_purpose: GUARDIAN_VERIFICATION_PURPOSE,
      });
      if (!isValid) {
        return {
          error: null,
          needsGuardianVerification: true,
          guardianVerificationPhone: guardianPhone,
          guardianVerificationNotice: "That code didn't match — check it and try again, or submit without confirming.",
        };
      }
      guardianIdentityVerified = true;
    } else if (canReceiveOtp && (intent === "" || intent === "resend")) {
      const { error: otpError } = await admin.functions.invoke("request-otp", {
        body: { phone: guardianPhone, purpose: GUARDIAN_VERIFICATION_PURPOSE },
      });
      return {
        error: null,
        needsGuardianVerification: true,
        guardianVerificationPhone: guardianPhone,
        guardianVerificationNotice: otpError
          ? "We couldn't send a verification code right now — you can still submit without confirming."
          : intent === "resend"
            ? "We've sent a new code."
            : "We've texted a 6-digit code to this number to confirm it's you. This step is optional — you can submit without it.",
      };
    } else {
      // Not a format we can send an OTP to (or an unexpected intent value) — proceed
      // unverified rather than getting the applicant stuck.
      guardianIdentityVerified = false;
    }
  } else {
    const { data: parentRole } = await admin.from("roles").select("id").eq("name", "parent").single();
    if (!parentRole) return { error: "Could not process your application — contact the school directly." };

    const { data: createdGuardian, error: guardianError } = await admin
      .from("school_users")
      .insert({
        school_id: school.id,
        role_id: parentRole.id,
        full_name: guardianName,
        phone: guardianPhone,
        email: guardianEmail || null,
      })
      .select("id")
      .single();
    if (guardianError || !createdGuardian) {
      return { error: guardianError?.message ?? "Could not process your application." };
    }
    guardianId = createdGuardian.id as string;
  }

  const { data: applicationNumber, error: numberError } = await admin.rpc("generate_application_number", {
    p_school_id: school.id,
  });
  if (numberError || !applicationNumber) {
    return { error: "Could not generate an application number. Please try again." };
  }

  const { data: application, error: applicationError } = await admin
    .from("applications")
    .insert({
      school_id: school.id,
      application_number: applicationNumber,
      status: "submitted",
      application_source: "online",
      admission_type: "new",
      first_name: firstName,
      last_name: lastName,
      other_names: otherNames || null,
      date_of_birth: dateOfBirth,
      gender,
      notes: notes || null,
      guardian_id: guardianId,
      guardian_relationship: ["mother", "father", "guardian", "other"].includes(relationship)
        ? relationship
        : "guardian",
      submitted_at: new Date().toISOString(),
      guardian_identity_verified: guardianIdentityVerified,
    })
    .select("id, application_number, access_token")
    .single();
  if (applicationError || !application) {
    return { error: applicationError?.message ?? "Could not submit your application. Please try again." };
  }

  // Document uploads — configurable per school (application_document_requirements). Best-effort:
  // a failed upload doesn't fail the whole application, since the applicant can add it later from
  // their status/upload link, and the reviewer can request it explicitly if missing.
  const { data: requirements } = await admin
    .from("application_document_requirements")
    .select("category")
    .eq("school_id", school.id);

  for (const req of requirements ?? []) {
    const file = formData.get(`document_${req.category}`);
    if (!(file instanceof File) || file.size === 0) continue;

    const path = `${school.id}/${application.id}/${req.category}-${Date.now()}-${safeStorageFilename(file.name)}`;
    const { error: uploadError } = await admin.storage.from("application-documents").upload(path, file);
    if (uploadError) continue;

    await admin.from("documents").insert({
      school_id: school.id,
      application_id: application.id,
      category: req.category,
      file_name: file.name,
      storage_path: path,
      storage_bucket: "application-documents",
      uploaded_by: guardianId,
    });
  }

  // Confirmation notification (test checklist: "Submit an online application -> confirmation
  // notification received"). No authenticated session here, so queue_communication (which checks
  // auth_has_permission against the caller) can't be used — insert directly, same as any other
  // system-initiated notification, then best-effort trigger dispatch immediately rather than
  // waiting for a staff member to next open Communication.
  const confirmationBody = `Hi ${guardianName}, we've received ${firstName} ${lastName}'s application to ${school.name} (Ref: ${application.application_number}). We'll be in touch.${school.admission_response_note ? ` ${school.admission_response_note}.` : ""} Track status: `;
  await admin.from("notification_logs").insert({
    school_id: school.id,
    recipient_phone: guardianPhone,
    recipient_school_user_id: guardianId,
    recipient_type: "guardian",
    channel: "sms",
    body: confirmationBody,
    status: "queued",
    segments: Math.max(1, Math.ceil(confirmationBody.length / 160)),
  });
  try {
    await admin.functions.invoke("send-communication");
  } catch {
    // Best-effort — the row stays 'queued' and gets swept the next time a staff member opens
    // Communication, same fallback path the absence-alert trigger already relies on.
  }

  return {
    error: null,
    success: true,
    applicationNumber: application.application_number,
    accessToken: application.access_token,
  };
}
