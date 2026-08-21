"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { setSchoolSlugCookie, clearSchoolSlugCookie } from "@/lib/school-slug-cookie";

export type LoginState = { error: string | null };

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  // Abuse guard, same increment_and_check_rate_limit() primitive/pattern as
  // signup (src/app/signup/actions.ts): this endpoint is public/unauthenticated
  // and every failed attempt still costs a real Supabase Auth verification, so
  // nothing previously stopped a script from credential-stuffing it. Two
  // buckets, since either could be abused independently -- IP catches one
  // source hammering many accounts, email catches many sources (e.g. a
  // botnet) hammering one account.
  const forwardedFor = (await headers()).get("x-forwarded-for");
  const clientIp = forwardedFor?.split(",")[0]?.trim() || "unknown";
  try {
    const adminClient = createAdminClient();
    const [{ data: withinIpLimit }, { data: withinEmailLimit }] = await Promise.all([
      adminClient.rpc("increment_and_check_rate_limit", {
        p_bucket: `login-ip:${clientIp}`,
        p_max_events: 20,
        p_window_seconds: 3600,
      }),
      adminClient.rpc("increment_and_check_rate_limit", {
        p_bucket: `login-email:${email.toLowerCase()}`,
        p_max_events: 10,
        p_window_seconds: 3600,
      }),
    ]);
    if (withinIpLimit === false || withinEmailLimit === false) {
      return { error: "Too many login attempts. Please wait a while and try again." };
    }
  } catch {
    // If the admin client isn't configured in this environment, fall through
    // rather than blocking login entirely over a missing rate-limit layer --
    // Supabase Auth's own project-level rate limiting is still in effect.
  }

  const supabase = await createClient();
  const { data: signInData, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // Banned accounts (deactivated/suspended at any school -- see
    // setStaffStatus in settings/actions.ts) get a specific message. This
    // doesn't leak whether an email exists in the way a "no such account"
    // message would -- it only fires after a password that actually
    // authenticates against a real, banned account.
    if (error.message?.toLowerCase().includes("banned")) {
      return { error: "This account has been deactivated. Contact your school admin." };
    }
    // Deliberately generic otherwise: don't confirm whether the email exists.
    return { error: "Invalid email or password." };
  }

  // Forced password-change / temp-password expiry gate. Only applies to
  // staff (school_owner, teacher, etc.) -- parents/students never have
  // must_change_password set since they authenticate via OTP, not a
  // password an admin generated for them.
  if (signInData.user) {
    const { data: schoolUser } = await supabase
      .from("school_users")
      .select("must_change_password, temp_password_expires_at")
      .eq("auth_user_id", signInData.user.id)
      .maybeSingle();

    if (schoolUser?.must_change_password) {
      const expiresAt = schoolUser.temp_password_expires_at
        ? new Date(schoolUser.temp_password_expires_at).getTime()
        : null;
      if (expiresAt !== null && Date.now() > expiresAt) {
        // The temp password itself still authenticates against Supabase
        // Auth (we have no server-side way to expire the password
        // credential from here) -- but the app never establishes a real
        // session on top of an expired, unused temp password. Sign back
        // out immediately and send the person to an admin instead.
        await supabase.auth.signOut();
        return {
          error: "Your temporary password has expired. Ask your school admin to reset it.",
        };
      }

      redirect("/change-password");
    }
  }

  // Slug is cosmetic (see school-slug-cookie.ts) -- never block or fail the
  // login itself if this lookup has any trouble.
  const cookieStore = await cookies();
  try {
    const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
    if (isSuperAdmin) {
      clearSchoolSlugCookie(cookieStore);
    } else if (signInData.user) {
      const { data: schoolUser } = await supabase
        .from("school_users")
        .select("schools(slug)")
        .eq("auth_user_id", signInData.user.id)
        .maybeSingle();
      const slug = (schoolUser?.schools as unknown as { slug: string } | null)?.slug;
      if (slug) setSchoolSlugCookie(cookieStore, slug);
    }
  } catch {
    // Fall through -- worst case the URL just isn't slug-prefixed this session.
  }

  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  clearSchoolSlugCookie(cookieStore);
  redirect("/login");
}
