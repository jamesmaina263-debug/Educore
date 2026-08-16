"use server";

import { createClient } from "@/lib/supabase/server";

// Manual "send now" button next to a term in Academics > Years & Terms.
// send_term_newsletter() is idempotent (one row per term in term_newsletter_log),
// so clicking this after the automatic daily sweep already ran for this term is
// a safe no-op that just reports the existing recipient count back.
export async function sendTermNewsletterAction(
  termId: string,
): Promise<{ error: string } | { success: true; recipientCount: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("send_term_newsletter", { p_term_id: termId });
  if (error) return { error: error.message };
  return { success: true, recipientCount: (data as number) ?? 0 };
}
