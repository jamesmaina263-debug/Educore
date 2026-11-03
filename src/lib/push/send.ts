import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPushPayload, classifyPushStatus, looksLikeVapidPublicKey, type PushMessage } from "@/lib/push/payload";

// Server-side web push sender (WP 8.3). Nothing calls this except the explicit "send me a test" action;
// real notification triggers (fees, announcements, ...) are separate, later decisions.
//
// Needs three environment variables, set by the site owner in the deployment (never in code):
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY  the public key (also given to browsers)
//   VAPID_PRIVATE_KEY             the matching private key (secret)
//   VAPID_SUBJECT                 optional, a mailto: or https: contact (defaults to the support address)
// Generate a pair with: npx web-push generate-vapid-keys

export function isPushConfigured(): boolean {
  return looksLikeVapidPublicKey(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) && Boolean(process.env.VAPID_PRIVATE_KEY);
}

export interface PushResult {
  configured: boolean;
  targets: number;
  sent: number;
  dead: number;
  failed: number;
}

const CHUNK = 20;

export async function sendPushToUsers(schoolId: string, schoolUserIds: string[], msg: PushMessage): Promise<PushResult | { error: string }> {
  if (!isPushConfigured()) return { configured: false, targets: 0, sent: 0, dead: 0, failed: 0 };
  const built = buildPushPayload(msg);
  if ("error" in built) return { error: built.error };

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() || "mailto:support@educoreafrica.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string,
    process.env.VAPID_PRIVATE_KEY as string,
  );

  const admin = createAdminClient();
  // The database function returns nothing when the school's flag is off, so this is safe to call blindly.
  const { data, error } = await admin.rpc("push_targets_for_users", { p_school_id: schoolId, p_school_user_ids: schoolUserIds });
  if (error) return { error: "Could not look up devices." };
  const targets = (data ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[];

  const result: PushResult = { configured: true, targets: targets.length, sent: 0, dead: 0, failed: 0 };
  for (let i = 0; i < targets.length; i += CHUNK) {
    const batch = targets.slice(i, i + CHUNK);
    const outcomes = await Promise.all(
      batch.map(async (t) => {
        try {
          const res = await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, built.payload, {
            TTL: 3600,
            urgency: "normal",
            timeout: 8000,
          });
          return { t, outcome: classifyPushStatus(res.statusCode) };
        } catch (e) {
          const status = typeof (e as { statusCode?: unknown }).statusCode === "number" ? (e as { statusCode: number }).statusCode : 0;
          return { t, outcome: status ? classifyPushStatus(status) : ("failed" as const) };
        }
      }),
    );
    for (const { t, outcome } of outcomes) {
      if (outcome === "ok") result.sent += 1;
      else if (outcome === "dead") {
        result.dead += 1;
        await admin.rpc("mark_push_subscription_dead", { p_endpoint: t.endpoint });
      } else result.failed += 1;
    }
  }
  return result;
}
