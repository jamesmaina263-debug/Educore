"use server";

import { createClient } from "@/lib/supabase/server";

export interface PlatformNotification {
  id: string;
  title: string;
  body: string;
  action_path: string | null;
  created_at: string;
  read_at: string | null;
}

export async function getPlatformNotifications(): Promise<
  { error: string } | { success: true; notifications: PlatformNotification[] }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data, error } = await supabase
    .from("platform_notifications")
    .select("id, title, body, action_path, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return { error: error.message };

  return { success: true, notifications: (data ?? []) as PlatformNotification[] };
}

export async function markPlatformNotificationReadAction(id: string): Promise<{ error: string } | { success: true }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_platform_notification_read", { p_notification_id: id });
  if (error) return { error: error.message };
  return { success: true };
}

// Bulk-marks every platform notification read (shared read-state -- see the migration comment
// on platform_notifications.read_at for why this is fine with exactly one platform admin today).
export async function clearAllPlatformNotificationsAction(): Promise<{ error: string } | { success: true }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_all_platform_notifications");
  if (error) return { error: error.message };
  return { success: true };
}
