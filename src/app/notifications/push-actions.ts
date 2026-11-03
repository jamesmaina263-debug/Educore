"use server";

import { createClient } from "@/lib/supabase/server";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { PUSH_FLAG } from "@/lib/push/payload";
import { isPushConfigured, sendPushToUsers } from "@/lib/push/send";

type TestResult = { error: string } | { success: true; message: string };

// "Send me a test notification". Self only: the recipient is always the signed-in person's own school-user
// id, taken from the session, never from the request, so this cannot be used to message anyone else.
export async function sendTestPushAction(): Promise<TestResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };
  if (!(await hasFeatureFlag(supabase, PUSH_FLAG))) return { error: "Push notifications are not enabled for your school." };
  if (!isPushConfigured()) return { error: "Push notifications are not set up on the server yet." };

  const { data: me } = await supabase.from("school_users").select("id, school_id").eq("auth_user_id", user.id).maybeSingle();
  if (!me) return { error: "Could not find your account." };

  const result = await sendPushToUsers(me.school_id as string, [me.id as string], {
    title: "EduCore test notification",
    body: "Notifications are working on this device.",
    url: "/",
    tag: "educore-test",
  });
  if ("error" in result) return { error: result.error };
  if (result.targets === 0) return { error: "No device is enabled for your account yet. Turn notifications on first." };
  if (result.sent === 0) return { error: "The notification could not be delivered. Try turning notifications off and on again." };
  return { success: true, message: `Sent to ${result.sent} device${result.sent === 1 ? "" : "s"}.` };
}
