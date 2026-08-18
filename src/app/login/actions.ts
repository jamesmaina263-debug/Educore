"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
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

  const supabase = await createClient();
  const { data: signInData, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // Deliberately generic: don't confirm whether the email exists.
    return { error: "Invalid email or password." };
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
