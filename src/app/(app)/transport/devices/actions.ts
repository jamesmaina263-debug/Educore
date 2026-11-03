"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";

// Driver codes (tracker devices). Thin calls to the WP 5.1 database functions, which check transport.write, the
// school and the feature flag themselves. The code is returned once here and never stored in readable form.

export async function createDriverCodeAction(vehicleId: string, label: string): Promise<{ error: string } | { success: true; token: string }> {
  const name = label.trim();
  if (!vehicleId) return { error: "Choose a vehicle." };
  if (name.length < 1 || name.length > 80) return { error: "Label must be 1 to 80 characters." };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("create_tracker_device", { p_vehicle_id: vehicleId, p_label: name });
  if (error) return { error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as { token?: string } | null;
  if (!row?.token) return { error: "No code was returned. Try again." };
  revalidatePath("/transport/devices");
  return { success: true, token: row.token };
}

export async function revokeDriverCodeAction(deviceId: string): Promise<{ error: string } | { success: true }> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("revoke_tracker_device", { p_device_id: deviceId });
  if (error) return { error: error.message };
  revalidatePath("/transport/devices");
  return { success: true };
}
