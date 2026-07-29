import type { SupabaseClient } from "@supabase/supabase-js";

interface FindOrCreateGuardianInput {
  phone: string;
  full_name: string;
  email?: string;
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
  const { data: existing, error: lookupError } = await supabase
    .from("school_users")
    .select("id, roles(name)")
    .eq("phone", input.phone)
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
      phone: input.phone,
      email: input.email || null,
    })
    .select("id")
    .single();

  if (createError || !created) {
    return { error: createError?.message ?? "Could not create the guardian account." };
  }

  return { id: created.id as string };
}
