"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export type ApplyState = {
  error: string | null;
  success?: boolean;
  applicationNumber?: string;
  accessToken?: string;
};

const initialState: ApplyState = { error: null };

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

  const { data: school, error: schoolError } = await admin
    .from("schools")
    .select("id, name, status")
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
      error: "It looks like this application was already submitted recently. The school will be in touch.",
    };
  }

  // Find-or-create the guardian identity — admin-client version of lib/guardians.ts's
  // findOrCreateGuardian (that helper relies on auth_school_id(), which doesn't exist here since
  // nobody is signed in yet).
  let guardianId: string;
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

    const path = `${school.id}/${application.id}/${req.category}-${Date.now()}-${file.name}`;
    const { error: uploadError } = await admin.storage.from("application-documents").upload(path, file);
    if (uploadError) continue;

    await admin.from("documents").insert({
      school_id: school.id,
      application_id: application.id,
      category: req.category,
      file_name: file.name,
      storage_path: path,
      uploaded_by: guardianId,
    });
  }

  // Confirmation notification (test checklist: "Submit an online application -> confirmation
  // notification received"). No authenticated session here, so queue_communication (which checks
  // auth_has_permission against the caller) can't be used — insert directly, same as any other
  // system-initiated notification, then best-effort trigger dispatch immediately rather than
  // waiting for a staff member to next open Communication.
  const confirmationBody = `Hi ${guardianName}, we've received ${firstName} ${lastName}'s application to ${school.name} (Ref: ${application.application_number}). We'll be in touch. Track status: `;
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

export { initialState as applyInitialState };
