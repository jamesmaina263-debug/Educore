"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface BroadcastHistoryRow {
  subject: string;
  body: string;
  sent_at: string;
  recipient_count: number;
}

type SendResult = { error: string } | { success: true; recipientCount: number };

// Every active school_user (any role, any school) gets an in-app notification-bell entry --
// see the migration for why that's the right audience and delivery mechanism.
export async function sendBroadcastAnnouncement(subject: string, body: string): Promise<SendResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("broadcast_platform_announcement", {
    p_subject: subject,
    p_body: body,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/broadcast");
  return { success: true, recipientCount: (data as number) ?? 0 };
}
