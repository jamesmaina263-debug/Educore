"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/slug";
import { setSchoolSlugCookie } from "@/lib/school-slug-cookie";

export type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_per_student_kes: number;
  billing_period: string;
};

export async function getActivePlans(): Promise<Plan[]> {
  // Public pricing needs to be readable before anyone has an account, so
  // this goes through the admin client server-side rather than opening an
  // anon RLS policy on subscription_plans (kept authenticated-only, see the
  // billing migration comment).
  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch {
    return [];
  }
  const { data } = await adminClient
    .from("subscription_plans")
    .select("id, code, name, description, price_per_student_kes, billing_period")
    .eq("is_active", true)
    .order("price_per_student_kes", { ascending: true });
  return data ?? [];
}

export type SignupState = { error: string | null };

export async function signUpSchool(
  _prevState: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const schoolName = String(formData.get("school_name") ?? "").trim();
  const ownerName = String(formData.get("owner_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const planId = String(formData.get("plan_id") ?? "");

  if (!schoolName || !ownerName || !email || !password || !planId) {
    return { error: "All fields except phone are required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Signup is not configured yet." };
  }

  // Abuse guard: this endpoint is public/unauthenticated and creates a real Supabase Auth
  // user + school + 30-day trial subscription on every successful call — previously nothing
  // stopped a script from spamming it. Keyed by client IP (Vercel sets x-forwarded-for), 5
  // signups per IP per hour. increment_and_check_rate_limit() already existed for exactly
  // this purpose but had never actually been called from anywhere in the app.
  const forwardedFor = (await headers()).get("x-forwarded-for");
  const clientIp = forwardedFor?.split(",")[0]?.trim() || "unknown";
  const { data: withinLimit } = await adminClient.rpc("increment_and_check_rate_limit", {
    p_bucket: `signup:${clientIp}`,
    p_max_events: 5,
    p_window_seconds: 3600,
  });
  if (withinLimit === false) {
    return { error: "Too many signup attempts from this network. Please try again later." };
  }

  // 1. Owner auth account.
  const { data: created, error: userError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !created.user) {
    return { error: userError?.message ?? "Could not create your account." };
  }

  // 2. The school itself, trialing from day one.
  const baseSlug = slugify(schoolName);
  const slug = `${baseSlug}-${created.user.id.slice(0, 6)}`;
  const { data: school, error: schoolError } = await adminClient
    .from("schools")
    .insert({ name: schoolName, slug, status: "trial" })
    .select("id")
    .single();
  if (schoolError || !school) {
    await adminClient.auth.admin.deleteUser(created.user.id);
    return { error: schoolError?.message ?? "Could not create the school." };
  }

  // 3. Owner's school_users row. Every default role/permission (all 12
  // roles) is already seeded platform-wide with school_id null — see the
  // billing/rollover session's discovery — so no per-school permission
  // seeding step is needed here at all.
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
    full_name: ownerName,
    email,
    phone: phone || null,
    status: "active",
  });
  if (linkError) {
    await adminClient.from("schools").delete().eq("id", school.id);
    await adminClient.auth.admin.deleteUser(created.user.id);
    return { error: linkError.message };
  }

  // 4. Start the trial. Called via the admin client (service_role JWT),
  // which start_trial_subscription() explicitly allows alongside
  // auth_is_super_admin() — no human approval needed for a trial.
  const { error: trialError } = await adminClient.rpc("start_trial_subscription", {
    p_school_id: school.id,
    p_plan_id: planId,
    p_trial_days: 30,
  });
  if (trialError) {
    await adminClient.from("school_users").delete().eq("auth_user_id", created.user.id);
    await adminClient.from("schools").delete().eq("id", school.id);
    await adminClient.auth.admin.deleteUser(created.user.id);
    return { error: trialError.message };
  }

  // 5. Sign the new owner in for real (admin client can't establish a
  // browser session — do that with the regular cookie-based client).
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    // Account and school were created successfully — just send them to
    // log in manually rather than failing the whole signup at this point.
    redirect("/login");
  }

  try {
    const cookieStore = await cookies();
    setSchoolSlugCookie(cookieStore, slug);
  } catch {
    // Cosmetic only -- see school-slug-cookie.ts. Never fail signup over this.
  }

  redirect("/dashboard");
}
