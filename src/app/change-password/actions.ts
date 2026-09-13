"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPasswordPwned } from "@/lib/password-breach-check";

export type ChangePasswordState = { error: string | null };

export async function changePassword(
  _prevState: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const newPassword = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (newPassword.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (newPassword !== confirmPassword) {
    return { error: "Passwords don't match." };
  }
  // Free-tier substitute for Supabase's paid leaked-password-protection
  // toggle — see password-breach-check.ts for why this fails open rather
  // than closed.
  if (await isPasswordPwned(newPassword)) {
    return {
      error:
        "This password has appeared in a known data breach and isn't safe to use. Please choose a different password.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) return { error: updateError.message };

  // Clear the gating flags via the service-role client. auth.uid() is null
  // for service-role calls, which the escalation-guard trigger on
  // school_users treats as trusted -- the regular (user-scoped) client
  // can't touch these two columns on its own row (see the migration that
  // introduced them), specifically so a user can't clear this flag without
  // actually going through supabase.auth.updateUser() above.
  try {
    const adminClient = createAdminClient();
    await adminClient
      .from("school_users")
      .update({
        must_change_password: false,
        temp_password_expires_at: null,
        password_changed_at: new Date().toISOString(),
      })
      .eq("auth_user_id", user.id);
  } catch {
    // If the admin client isn't configured, the password itself is still
    // changed (the important part) -- worst case the person is prompted
    // to change it again next login, which is safe, just redundant.
  }

  redirect("/dashboard");
}
