import type { SupabaseClient } from "@supabase/supabase-js";

interface FindOrCreateGuardianInput {
  phone: string;
  full_name: string;
  email?: string;
}

const KENYA_PHONE_RE = /^\+254\d{9}$/;

/**
 * Normalizes a Kenyan phone number to E.164 (+254XXXXXXXXX) so the same
 * physical number always produces the same string, regardless of how it was
 * typed. Without this, "0712345678", "712345678", and "+254712345678" are
 * three different strings to a `.eq("phone", ...)` lookup even though
 * they're the same guardian -- which is exactly how one real parent ended up
 * with two separate school_users identities (one entered via the online
 * application, already E.164 per KENYA_PHONE_RE in apply/[slug]/actions.ts;
 * one typed directly into the "Add guardian" form on the student profile,
 * unvalidated, in local format).
 *
 * Returns null if the input isn't a recognizable Kenyan mobile number, so
 * the caller can surface a real validation error instead of silently
 * storing (and later failing to match against) a malformed number.
 */
export function normalizeKenyanPhone(raw: string): string | null {
  const digits = raw.trim().replace(/[\s\-()]/g, "");
  if (KENYA_PHONE_RE.test(digits)) return digits;
  if (/^0[17]\d{8}$/.test(digits)) return `+254${digits.slice(1)}`;
  if (/^254[17]\d{8}$/.test(digits)) return `+${digits}`;
  if (/^[17]\d{8}$/.test(digits)) return `+254${digits}`;
  return null;
}

/**
 * Finds an existing parent by phone within the caller's school, or
 * creates a new school_users row (role=parent) for them. A guardian IS
 * a parent identity (Phase 0) — this never creates a separate
 * "guardians" record.
 *
 * Known gap, not fixed here: school_users.phone has no uniqueness
 * constraint, so a parent with children at two different EduCore
 * schools will get two separate identities today — and Phase 0's
 * verify-otp lookup (`.eq("phone", phone).maybeSingle()`) would break
 * if the same phone ever existed as an *active* row in two schools
 * simultaneously. Real fix needs a product decision (school-scoped
 * login vs. one cross-school identity) beyond this module's scope —
 * flagged, not silently worked around.
 */
export async function findOrCreateGuardian(
  supabase: SupabaseClient,
  input: FindOrCreateGuardianInput,
): Promise<{ id: string } | { error: string }> {
  const normalizedPhone = normalizeKenyanPhone(input.phone);
  if (!normalizedPhone) {
    return { error: "Please provide a valid Kenyan phone number, e.g. 0712345678 or +254712345678." };
  }

  const { data: existing, error: lookupError } = await supabase
    .from("school_users")
    .select("id, roles(name)")
    .eq("phone", normalizedPhone)
    .maybeSingle();

  if (lookupError) {
    return { error: lookupError.message };
  }

  if (existing) {
    const roleName = (existing.roles as unknown as { name: string } | null)?.name;
    if (roleName !== "parent") {
      return { error: "This phone number is already registered under a different role." };
    }
    return { id: existing.id as string };
  }

  const { data: parentRole, error: roleError } = await supabase
    .from("roles")
    .select("id")
    .eq("name", "parent")
    .single();

  if (roleError || !parentRole) {
    return { error: "Could not resolve the parent role." };
  }

  const { data: schoolId, error: schoolIdError } = await supabase.rpc("auth_school_id");
  if (schoolIdError || !schoolId) {
    return { error: "Could not resolve your school." };
  }

  const { data: created, error: createError } = await supabase
    .from("school_users")
    .insert({
      school_id: schoolId,
      role_id: parentRole.id,
      full_name: input.full_name,
      phone: normalizedPhone,
      email: input.email || null,
    })
    .select("id")
    .single();

  if (createError || !created) {
    return { error: createError?.message ?? "Could not create the guardian account." };
  }

  return { id: created.id as string };
}
