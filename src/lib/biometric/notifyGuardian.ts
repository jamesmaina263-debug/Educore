import type { createAdminClient } from "@/lib/supabase/admin";
import { getSmsProvider } from "@/lib/sms";

// Deliberate content/behavior duplicate of the guardian-notification block
// inside supabase/functions/biometric-verify/index.ts (template matching,
// notification_preferences check, notification_logs bookkeeping, all of
// it) -- ported here because that block lives inside a Deno Edge Function
// and /iclock/cdata is a Vercel Route Handler (see that route's header
// comment for why). This is the piece of PR #29 that was deliberately left
// out of the first pass; see /iclock/cdata/route.ts's header comment,
// which should be updated once this is wired in.
//
// Kept as its own module (rather than inlined in the route) so the two
// duplicate copies -- this one and biometric-verify's -- are each a single
// self-contained unit that's easy to diff against the other by hand when
// checking for drift, e.g. if the message template or preference logic
// changes in one place and needs to be ported to the other.
//
// NOT a dry_run-aware function like biometric-verify's -- a real device
// push is never a rehearsal, so dry_run was never plumbed through
// /iclock/cdata's payload parsing. If that's ever needed (e.g. to test
// against a real enrolled student without texting their guardian while
// verifying the hardware payload shape), it would need to be added to
// both the route's query-param handling and this function's signature.

type AdminClient = ReturnType<typeof createAdminClient>;

export type GuardianNotificationStatus = "sent" | "failed" | "skipped";

interface NotifyGuardianParams {
  schoolId: string;
  studentId: string;
  eventType: "check_in" | "check_out";
  occurredAt: Date;
  /** biometric_events row this notification is being sent for, for notification_logs bookkeeping. */
  sourceModule?: string;
}

function renderPlaceholders(body: string, values: Record<string, string>): string {
  let result = body;
  for (const [key, value] of Object.entries(values)) result = result.replaceAll(`{{${key}}}`, value);
  return result;
}

export async function notifyGuardianOfGateEvent(
  admin: AdminClient,
  params: NotifyGuardianParams,
): Promise<{ status: GuardianNotificationStatus; logId: string | null }> {
  const { schoolId, studentId, eventType, occurredAt, sourceModule = "biometric" } = params;

  const { data: student } = await admin.from("students").select("first_name, last_name").eq("id", studentId).maybeSingle();
  const { data: school } = await admin.from("schools").select("name").eq("id", schoolId).single();
  const { data: guardians } = await admin
    .from("student_guardians")
    .select("guardian_user_id, guardian:school_users(id, phone)")
    .eq("student_id", studentId);

  const recipients = (guardians ?? [])
    .map((g) => g.guardian as unknown as { id: string; phone: string | null } | null)
    .filter((su): su is { id: string; phone: string } => !!su?.phone);

  if (recipients.length === 0) {
    return { status: "skipped", logId: null };
  }

  const studentName = student ? `${student.first_name} ${student.last_name}` : "Student";
  const schoolName = school?.name ?? "School";
  const timeLabel = occurredAt.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: true });

  const { data: templates } = await admin
    .from("communication_templates")
    .select("id, name, body")
    .eq("school_id", schoolId)
    .eq("category", "gate_attendance")
    .eq("channel", "sms");
  const hints = eventType === "check_in" ? ["check-in", "checkin", "arrival"] : ["check-out", "checkout", "departure"];
  const matchedTemplate = (templates ?? []).find((t) => hints.some((h) => t.name.toLowerCase().includes(h))) ?? (templates ?? [])[0] ?? null;
  const defaultBody =
    eventType === "check_in"
      ? "{{school_name}}: {{student_name}} has arrived at school ({{time}})."
      : "{{school_name}}: {{student_name}} has left school ({{time}}).";
  const renderedBody = renderPlaceholders(matchedTemplate?.body ?? defaultBody, {
    student_name: studentName,
    school_name: schoolName,
    time: timeLabel,
  });

  const smsProvider = getSmsProvider();
  let anySent = false;
  let anySkipped = 0;
  let lastLogId: string | null = null;

  for (const recipient of recipients) {
    const { data: pref } = await admin
      .from("notification_preferences")
      .select("enabled")
      .eq("school_user_id", recipient.id)
      .eq("category", "gate_attendance")
      .eq("channel", "sms")
      .maybeSingle();
    if (pref && pref.enabled === false) {
      anySkipped++;
      continue;
    }

    const { data: logRow } = await admin
      .from("notification_logs")
      .insert({
        school_id: schoolId,
        student_id: studentId,
        recipient_phone: recipient.phone,
        recipient_type: "guardian",
        recipient_school_user_id: recipient.id,
        channel: "sms",
        template_id: matchedTemplate?.id ?? null,
        body: renderedBody,
        segments: Math.max(1, Math.ceil(renderedBody.length / 160)),
        sent_by: null,
        source_module: sourceModule,
      })
      .select("id")
      .single();
    if (!logRow) continue;
    lastLogId = logRow.id;

    try {
      await smsProvider.send(recipient.phone, renderedBody);
      await admin.from("notification_logs").update({ status: "sent", updated_at: new Date().toISOString() }).eq("id", logRow.id);
      anySent = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await admin
        .from("notification_logs")
        .update({ status: "failed", provider_response: message.slice(0, 500), updated_at: new Date().toISOString() })
        .eq("id", logRow.id);
    }
  }

  const status: GuardianNotificationStatus = anySkipped === recipients.length ? "skipped" : anySent ? "sent" : "failed";
  return { status, logId: lastLogId };
}
