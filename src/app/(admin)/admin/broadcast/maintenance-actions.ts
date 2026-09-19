"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { logAdminAction } from "@/lib/log-admin-action";

export interface MaintenanceStatus {
  enabled: boolean;
  message: string | null;
  updatedAt: string | null;
}

type ToggleResult = { error: string } | { success: true };

export async function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_maintenance")
    .select("enabled, message, updated_at")
    .eq("id", 1)
    .maybeSingle();

  return {
    enabled: data?.enabled ?? false,
    message: data?.message ?? null,
    updatedAt: data?.updated_at ?? null,
  };
}

// Flips the platform-wide kill switch that src/lib/supabase/middleware.ts checks on every
// school-facing request. RLS on platform_maintenance restricts the actual UPDATE to
// super_admin, so this is defense in depth, not the real gate -- same posture as
// sendBroadcastAnnouncement next to it.
export async function setMaintenanceMode(enabled: boolean, message: string): Promise<ToggleResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("platform_maintenance")
    .update({
      enabled,
      message: message.trim() || null,
      updated_at: new Date().toISOString(),
      updated_by: user?.id ?? null,
    })
    .eq("id", 1);

  if (error) return { error: error.message };

  void logAdminAction(supabase, enabled ? "maintenance_mode_enabled" : "maintenance_mode_disabled", { message });
  revalidatePath("/admin/broadcast");
  revalidatePath("/maintenance");
  return { success: true };
}
