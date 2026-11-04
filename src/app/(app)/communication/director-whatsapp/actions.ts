"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { registerErrorMessage } from "@/lib/director-whatsapp";

type ActionResult = { error: string } | { success: true };

// Thin calls to director_whatsapp_register / director_whatsapp_revoke. The database functions check the caller's
// role (school owner, principal, deputy principal), the school's feature flag, the opt-in and that the number is the
// caller's own staff-profile number.
export async function registerDirectorNumberAction(phone: string, consent: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("director_whatsapp_register", { p_phone: phone.slice(0, 30), p_consent: consent === true });
  if (error) return { error: "You are not allowed to register a number for director questions." };
  const message = registerErrorMessage(data);
  if (message) return { error: message };
  revalidatePath("/communication/director-whatsapp");
  return { success: true };
}

export async function revokeDirectorNumberAction(): Promise<ActionResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("director_whatsapp_revoke");
  if (error) return { error: "Could not remove the number. Please try again." };
  revalidatePath("/communication/director-whatsapp");
  return { success: true };
}
