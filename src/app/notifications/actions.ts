"use server";

import { createClient } from "@/lib/supabase/server";

export type PrefCategory = "fee_reminder" | "absence_alert" | "result_published" | "announcement" | "other";
export type PrefChannel = "sms" | "email" | "whatsapp";

export interface PreferenceRow {
  category: PrefCategory;
  channel: PrefChannel;
  enabled: boolean;
}

// Opt-out model: a category/channel with no stored row is enabled by default. This returns only
// the rows that have actually been changed from that default — the UI fills in "enabled" for
// anything missing, same convention as the DB function notification_allowed().
export async function getMyNotificationPreferences(): Promise<
  { error: string } | { success: true; rows: PreferenceRow[] }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: me } = await supabase.from("school_users").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (!me) return { error: "Could not resolve your account." };

  const { data, error } = await supabase
    .from("notification_preferences")
    .select("category, channel, enabled")
    .eq("school_user_id", me.id);
  if (error) return { error: error.message };

  return { success: true, rows: (data ?? []) as PreferenceRow[] };
}

export async function setNotificationPreference(
  category: PrefCategory,
  channel: PrefChannel,
  enabled: boolean,
): Promise<{ error: string } | { success: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: me } = await supabase.from("school_users").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (!me) return { error: "Could not resolve your account." };

  const { error } = await supabase
    .from("notification_preferences")
    .upsert(
      { school_user_id: me.id, category, channel, enabled, updated_at: new Date().toISOString() },
      { onConflict: "school_user_id,category,channel" },
    );
  if (error) return { error: error.message };

  return { success: true };
}

export interface InAppNotification {
  id: string;
  body: string;
  subject: string | null;
  created_at: string;
  read_at: string | null;
  action_url: string | null;
}

export async function getMyInAppNotifications(): Promise<
  { error: string } | { success: true; notifications: InAppNotification[] }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data, error } = await supabase
    .from("notification_logs")
    .select("id, body, subject, created_at, read_at, action_url")
    .eq("channel", "in_app")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return { error: error.message };

  return { success: true, notifications: (data ?? []) as InAppNotification[] };
}

export async function markNotificationReadAction(id: string): Promise<{ error: string } | { success: true }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notification_read", { p_notification_id: id });
  if (error) return { error: error.message };
  return { success: true };
}
