import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCronRequest } from "@/lib/cron-auth";
import { sendSecurityAlert } from "@/lib/security-alert";
import {
  NEW_SCHOOL_WINDOW_HOURS,
  OUTBOUND_THRESHOLD,
  TRIAL_OUTBOUND_EVENT,
  alertedSchoolIdsFromDetails,
  countBySchool,
  newSchoolCutoff,
  schoolsToAlert,
} from "@/lib/trial-outbound-watch";

export const dynamic = "force-dynamic";

// Watchdog for abuse of the free trial: a school created in the last 24h, still on trial, that has
// already sent OUTBOUND_THRESHOLD or more external messages (SMS / email via notification_logs, or
// outbound WhatsApp). Read-only apart from raising an alert through the existing sendSecurityAlert
// (Slack + platform_alerts). It never blocks, suspends or edits a school.
//
// Called every 30 minutes by .github/workflows/trial-outbound-watch-cron.yml with
// EXTERNAL_CRON_SECRET (same pattern as /api/cron/mpesa-stale-pending).
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const externalCronSecret = process.env.EXTERNAL_CRON_SECRET;
  if (!cronSecret && !externalCronSecret) {
    return NextResponse.json({ error: "Neither CRON_SECRET nor EXTERNAL_CRON_SECRET is configured." }, { status: 500 });
  }
  const authorized =
    (!!cronSecret && isValidCronRequest(request, cronSecret)) ||
    (!!externalCronSecret && isValidCronRequest(request, externalCronSecret));
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Admin client not configured." },
      { status: 500 },
    );
  }

  const now = new Date();
  const cutoff = newSchoolCutoff(now);

  const fail = (what: string, message: string) => {
    void sendSecurityAlert("Trial outbound watch (/api/cron/trial-outbound-watch) failed", { step: what, error: message.slice(0, 300) });
    return NextResponse.json({ error: message }, { status: 500 });
  };

  // 1. Schools that are new and still on trial.
  const { data: schools, error: schoolsError } = await adminClient
    .from("schools")
    .select("id")
    .eq("status", "trial")
    .gte("created_at", cutoff)
    .limit(500);
  if (schoolsError) return fail("schools", schoolsError.message);
  const schoolIds = (schools ?? []).map((s) => s.id);
  if (schoolIds.length === 0) {
    return NextResponse.json({ new_trial_schools: 0, alerted: 0, ran_at: now.toISOString() });
  }

  // 2. Their external messages since they were created (in_app notifications are not "sending").
  const { data: notifications, error: notificationsError } = await adminClient
    .from("notification_logs")
    .select("school_id")
    .in("school_id", schoolIds)
    .neq("channel", "in_app")
    .gte("created_at", cutoff)
    .limit(5000);
  if (notificationsError) return fail("notification_logs", notificationsError.message);

  const { data: whatsapp, error: whatsappError } = await adminClient
    .from("whatsapp_messages")
    .select("school_id")
    .in("school_id", schoolIds)
    .eq("direction", "outbound")
    .gte("created_at", cutoff)
    .limit(5000);
  if (whatsappError) return fail("whatsapp_messages", whatsappError.message);

  const counts = countBySchool([...(notifications ?? []), ...(whatsapp ?? [])]);

  // 3. Dedup against earlier alerts. If this lookup fails we alert anyway: a repeated alert is far
  // better than a silent miss.
  const { data: priorAlerts, error: priorError } = await adminClient
    .from("platform_alerts")
    .select("detail")
    .eq("event", TRIAL_OUTBOUND_EVENT)
    .gte("created_at", cutoff);
  if (priorError) console.error("trial-outbound-watch: could not read prior alerts, alerting without dedup", priorError);
  const alreadyAlerted = alertedSchoolIdsFromDetails((priorAlerts ?? []).map((a) => a.detail as Record<string, unknown> | null));

  const fresh = schoolsToAlert(counts, alreadyAlerted);
  if (fresh.length === 0) {
    return NextResponse.json({ new_trial_schools: schoolIds.length, alerted: 0, ran_at: now.toISOString() });
  }

  await sendSecurityAlert(TRIAL_OUTBOUND_EVENT, {
    schools: String(fresh.length),
    threshold: `${OUTBOUND_THRESHOLD}+ messages within ${NEW_SCHOOL_WINDOW_HOURS}h of signup`,
    school_ids: fresh.map((s) => s.schoolId).join(","),
    message_counts: fresh.map((s) => `${s.schoolId.slice(0, 8)}=${s.count}`).join(","),
    next_step:
      "Check the school's notification_logs / whatsapp_messages and who signed up. Suspend the school in /admin if it looks like abuse.",
  });

  return NextResponse.json({ new_trial_schools: schoolIds.length, alerted: fresh.length, ran_at: now.toISOString() });
}
