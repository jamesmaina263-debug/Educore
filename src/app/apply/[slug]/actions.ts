"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export type ApplyState = { error: string | null; success?: boolean; admissionNumber?: string };

const initialState: ApplyState = { error: null };

function generateTempAdmissionNumber() {
  // Not a real admission number — the school assigns one during Admissions review, same as
  // every applicant. This is just a stable reference the applicant can quote when they call the
  // school office to check status.
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `APP-${stamp}-${rand}`;
}

export async function submitApplication(
  _prev: ApplyState,
  formData: FormData,
): Promise<ApplyState> {
  const slug = String(formData.get("school_slug") ?? "").trim();

  // Honeypot: a real applicant never fills this hidden field in. Bots that blindly fill every
  // input do. Reject silently-successful (don't tip off the bot) rather than with a visible error.
  const honeypot = String(formData.get("website") ?? "").trim();
  if (honeypot) {
    return { error: null, success: true, admissionNumber: "—" };
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
  const applicationNotes = String(formData.get("application_notes") ?? "").trim();

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
    .select("id, status")
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
  // after being rejected), just a speed bump against accidental double-submits and simple bots.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentDuplicate } = await admin
    .from("students")
    .select("id, student_guardians(school_users(phone))")
    .eq("school_id", school.id)
    .eq("first_name", firstName)
    .eq("last_name", lastName)
    .eq("status", "applied")
    .gte("created_at", since);
  const alreadyApplied = (recentDuplicate ?? []).some((s) => {
    const guardians = (s.student_guardians ?? []) as unknown as { school_users: { phone: string | null } | null }[];
    return guardians.some((g) => g.school_users?.phone === guardianPhone);
  });
  if (alreadyApplied) {
    return {
      error: "It looks like this application was already submitted recently. The school will be in touch.",
    };
  }

  // Find-or-create the guardian identity, admin-client version of lib/guardians.ts's
  // findOrCreateGuardian — that helper relies on auth_school_id() (the caller's own session),
  // which doesn't exist here since nobody is signed in yet.
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

  const { data: student, error: studentError } = await admin
    .from("students")
    .insert({
      school_id: school.id,
      admission_number: generateTempAdmissionNumber(),
      first_name: firstName,
      last_name: lastName,
      other_names: otherNames || null,
      date_of_birth: dateOfBirth,
      gender,
      application_notes: applicationNotes || null,
    })
    .select("id, admission_number")
    .single();
  if (studentError || !student) {
    return { error: studentError?.message ?? "Could not submit your application. Please try again." };
  }

  const { error: linkError } = await admin.from("student_guardians").insert({
    student_id: student.id,
    guardian_user_id: guardianId,
    relationship: ["mother", "father", "guardian", "other"].includes(relationship) ? relationship : "guardian",
    primary_contact: true,
  });
  if (linkError) {
    // Best-effort rollback so a half-created application doesn't sit in the pipeline silently.
    await admin.from("students").delete().eq("id", student.id);
    return { error: linkError.message };
  }

  return { error: null, success: true, admissionNumber: student.admission_number };
}

export { initialState as applyInitialState };
