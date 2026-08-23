// Receives a scan event from a registered biometric device (fingerprint/face
// scanner) at a school gate and, for a student scan, logs it and notifies
// guardians. Staff scans are recorded (Phase 2 will extend this to also
// populate staff_attendance.check_in_time/check_out_time) but do not yet
// trigger a notification -- there is no "notify someone about a staff
// check-in" requirement today.
//
// Auth model mirrors api-v1/index.ts exactly: a device is not a Supabase
// user and carries no JWT, so this function is deployed with verify_jwt
// disabled and authenticates the caller itself against
// biometric_devices.api_key_hash, using the same "prefix.secret" bearer
// format and sha256Hex comparison as api_keys. Nothing here trusts a
// caller-supplied school_id/student_id -- every ID used past auth is looked
// up from the verified device row or the enrollment row it owns.
//
// Dispatch model deliberately differs from send-communication/index.ts:
// that function requires a staff member with communication.write to visit
// the Communication page to flush the queue (see its own header comment --
// no pg_cron/pg_net wiring exists yet). A gate scan has no staff session
// behind it and "the parent is informed their child arrived" is the whole
// point of this feature, so this function queues the notification_logs row
// AND immediately attempts delivery itself, using the exact same
// _shared/sms provider module send-communication uses -- not a second SMS
// integration, just a second caller of the same one.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { getSmsProvider } from "../_shared/sms/index.ts";

type EventType = "check_in" | "check_out";

interface ScanRequestBody {
  external_template_id?: string;
  event_type?: EventType;
  event_at?: string; // optional ISO timestamp; defaults to now() on receipt
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function renderPlaceholders(body: string, values: Record<string, string>): string {
  let result = body;
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // --- Device authentication (mirrors api-v1's api_keys auth exactly) ---
  const authHeader = req.headers.get("authorization") ?? "";
  const rawKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!rawKey || !rawKey.includes(".")) {
    return json({ error: "Missing or malformed device key." }, 401);
  }
  const [keyPrefix, secret] = rawKey.split(/\.(.*)/s);
  if (!keyPrefix || !secret) {
    return json({ error: "Malformed device key." }, 401);
  }

  const { data: device, error: deviceLookupError } = await supabase
    .from("biometric_devices")
    .select("id, school_id, name, api_key_hash, status")
    .eq("api_key_prefix", keyPrefix)
    .maybeSingle();

  if (deviceLookupError || !device) {
    return json({ error: "Unknown device." }, 401);
  }
  if (device.status !== "active") {
    return json({ error: "This device has been deactivated." }, 401);
  }
  const secretHash = await sha256Hex(secret);
  if (!device.api_key_hash || secretHash !== device.api_key_hash) {
    return json({ error: "Invalid device key." }, 401);
  }

  // --- Parse and validate the scan payload ---
  let body: ScanRequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Request body must be JSON." }, 400);
  }
  const { external_template_id, event_type } = body;
  if (!external_template_id || typeof external_template_id !== "string") {
    return json({ error: "external_template_id is required." }, 400);
  }
  if (event_type !== "check_in" && event_type !== "check_out") {
    return json({ error: "event_type must be 'check_in' or 'check_out'." }, 400);
  }
  const eventAt = body.event_at ? new Date(body.event_at) : new Date();
  if (Number.isNaN(eventAt.getTime())) {
    return json({ error: "event_at is not a valid timestamp." }, 400);
  }

  // Best-effort; a failed usage-timestamp update should never block the scan itself.
  await supabase
    .from("biometric_devices")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", device.id);

  // --- Resolve the template to a person ---
  const { data: enrollment, error: enrollmentError } = await supabase
    .from("biometric_enrollments")
    .select("id, person_type, person_id")
    .eq("device_id", device.id)
    .eq("external_template_id", external_template_id)
    .eq("status", "active")
    .maybeSingle();

  if (enrollmentError || !enrollment) {
    return json({ error: "This template is not enrolled on this device." }, 404);
  }

  if (enrollment.person_type === "staff") {
    // Phase 2 will extend this branch to write staff_attendance.check_in_time /
    // check_out_time. Returning 501 rather than silently doing nothing, so a
    // device pointed at a staff enrollment fails loudly instead of looking
    // like a successful scan that did nothing.
    return json(
      { error: "Staff gate scans are not yet handled by this endpoint (coming in Phase 2)." },
      501,
    );
  }

  const studentId = enrollment.person_id;

  // --- Insert the raw gate event first -- this is the ground truth record,
  // independent of whether a notification can be sent. ---
  const { data: gateEvent, error: insertError } = await supabase
    .from("student_gate_events")
    .insert({
      school_id: device.school_id,
      student_id: studentId,
      device_id: device.id,
      event_type,
      event_at: eventAt.toISOString(),
      source: "biometric",
    })
    .select("id")
    .single();

  if (insertError || !gateEvent) {
    console.error(insertError);
    return json({ error: "Failed to record the scan." }, 500);
  }

  // --- Look up the student + school name for message rendering ---
  const [{ data: student }, { data: school }] = await Promise.all([
    supabase.from("students").select("first_name, last_name").eq("id", studentId).single(),
    supabase.from("schools").select("name").eq("id", device.school_id).single(),
  ]);

  const studentName = student ? `${student.first_name} ${student.last_name}` : "Student";
  const schoolName = school?.name ?? "School";
  const timeLabel = eventAt.toLocaleTimeString("en-KE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  // --- Guardians: notify everyone linked to this student who has a phone
  // on file, not just the primary contact -- unlike the automated
  // 3-consecutive-absences alert (which only messages the primary contact),
  // this is what "the parents are informed" was actually asked for. Each
  // guardian's own gate_attendance/sms preference is still respected
  // individually below. ---
  const { data: guardians } = await supabase
    .from("student_guardians")
    .select("guardian_user_id, guardian:school_users(id, phone)")
    .eq("student_id", studentId);

  const recipients = (guardians ?? [])
    .map((g) => g.guardian as unknown as { id: string; phone: string | null } | null)
    .filter((su): su is { id: string; phone: string } => !!su?.phone);

  if (recipients.length === 0) {
    await supabase
      .from("student_gate_events")
      .update({ notification_status: "skipped" })
      .eq("id", gateEvent.id);
    return json({ success: true, gate_event_id: gateEvent.id, notification: "skipped_no_guardian_phone" });
  }

  // Prefer a school-authored template (name hinting at direction; falls back
  // to any gate_attendance/sms template) so schools can customise wording,
  // same as every other communication category. Otherwise use a sensible
  // built-in default.
  const { data: templates } = await supabase
    .from("communication_templates")
    .select("id, name, body")
    .eq("school_id", device.school_id)
    .eq("category", "gate_attendance")
    .eq("channel", "sms");

  const directionHint = event_type === "check_in" ? ["check-in", "checkin", "arrival"] : ["check-out", "checkout", "departure"];
  const matchedTemplate =
    (templates ?? []).find((t) => directionHint.some((h) => t.name.toLowerCase().includes(h))) ??
    (templates ?? [])[0] ??
    null;

  const defaultBody =
    event_type === "check_in"
      ? "{{school_name}}: {{student_name}} has arrived at school ({{time}})."
      : "{{school_name}}: {{student_name}} has left school ({{time}}).";

  const renderedBody = renderPlaceholders(matchedTemplate?.body ?? defaultBody, {
    student_name: studentName,
    school_name: schoolName,
    time: timeLabel,
  });

  const smsProvider = getSmsProvider();
  let lastNotificationLogId: string | null = null;
  let anySent = false;
  let anyFailed = false;
  let allSkippedByPreference = true;

  for (const recipient of recipients) {
    const { data: pref } = await supabase
      .from("notification_preferences")
      .select("enabled")
      .eq("school_user_id", recipient.id)
      .eq("category", "gate_attendance")
      .eq("channel", "sms")
      .maybeSingle();

    const allowed = pref ? pref.enabled : true; // absence of a row means enabled, same convention as notification_allowed()
    if (!allowed) continue;
    allSkippedByPreference = false;

    const { data: logRow, error: logInsertError } = await supabase
      .from("notification_logs")
      .insert({
        school_id: device.school_id,
        student_id: studentId,
        recipient_phone: recipient.phone,
        recipient_type: "guardian",
        recipient_school_user_id: recipient.id,
        channel: "sms",
        template_id: matchedTemplate?.id ?? null,
        body: renderedBody,
        segments: Math.max(1, Math.ceil(renderedBody.length / 160)),
        sent_by: null,
        source_module: "gate",
      })
      .select("id")
      .single();

    if (logInsertError || !logRow) {
      console.error(logInsertError);
      anyFailed = true;
      continue;
    }
    lastNotificationLogId = logRow.id;

    try {
      await smsProvider.send(recipient.phone, renderedBody);
      await supabase
        .from("notification_logs")
        .update({ status: "sent", updated_at: new Date().toISOString() })
        .eq("id", logRow.id);
      anySent = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabase
        .from("notification_logs")
        .update({ status: "failed", provider_response: message.slice(0, 500), updated_at: new Date().toISOString() })
        .eq("id", logRow.id);
      anyFailed = true;
    }
  }

  const notificationStatus = allSkippedByPreference
    ? "skipped"
    : anySent && !anyFailed
      ? "sent"
      : anySent && anyFailed
        ? "sent" // at least one guardian was reached; partial failure is visible in notification_logs
        : "failed";

  await supabase
    .from("student_gate_events")
    .update({
      notification_status: notificationStatus,
      notification_log_id: lastNotificationLogId,
    })
    .eq("id", gateEvent.id);

  return json({
    success: true,
    gate_event_id: gateEvent.id,
    notification: notificationStatus,
    guardians_notified: recipients.length,
  });
});
