"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { mapBusAlertError } from "@/lib/bus-alerts";

// WP 5.4: a guardian's own choice to receive (or stop receiving) bus alerts. Thin call to set_my_bus_alerts(), which
// writes only the caller's own preference and refuses unless the school has the feature switched on.
export async function setMyBusAlerts(enabled: boolean): Promise<{ error: string } | { success: true }> {
  if (typeof enabled !== "boolean") return { error: "Invalid choice." };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };
  const { error } = await supabase.rpc("set_my_bus_alerts", { p_enabled: enabled });
  if (error) return { error: mapBusAlertError(error.code) };
  revalidatePath("/portal/bus");
  return { success: true };
}
