"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";

// A guardian sets or changes the PIN the WhatsApp bot asks for before it sends a document
// (feature.bot.documents). All the rules (parent only, flag on, 4-6 digits, no repeated or
// sequential PINs) live in the set_bot_pin() database function; this only passes the PIN through
// and turns its refusals into plain messages. The PIN is never logged or stored by the app.
export async function setWhatsAppPinAction(pin: string): Promise<{ error: string } | { success: true }> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  const { error } = await supabase.rpc("set_bot_pin", { p_pin: pin });
  if (error) {
    switch (error.code) {
      case "22023":
        return { error: error.message };
      case "55000":
        return { error: "WhatsApp documents are not switched on for your school yet." };
      case "42501":
        return { error: "Only a parent or guardian account can set a WhatsApp PIN." };
      default:
        return { error: "We could not save your PIN. Please try again." };
    }
  }
  revalidatePath("/portal/whatsapp-pin");
  return { success: true };
}
