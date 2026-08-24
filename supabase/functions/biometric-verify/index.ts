// Biometric verification + event ingestion for a registered device.
//
// Conceptual flow (matches the biometric module design doc): the device
// performs the actual biometric match LOCALLY and never sends us a
// fingerprint/face image, raw template, or embedding -- only which of its
// own opaque credential references matched, and the result. This function
// answers "who is this and did the device actually recognise them"
// (biometric_verifications, always written, success or failure) and, only
// on a genuine success, "what does that mean" by handing off to the
// EXISTING attendance module (student_attendance session='gate',
// staff_attendance) rather than a parallel one. It never decides who a
// person is by itself -- that already happened on the device before this
// request was made.
//
// Auth model mirrors api-v1/index.ts: a device is not a Supabase user and
// carries no JWT, so this function is deployed with verify_jwt disabled
// and authenticates the caller itself against biometric_devices via the
// same "prefix.secret" bearer + sha256Hex pattern as api_keys.
//
// Idempotency: event_id is supplied by the device/kiosk (its own local
// scan ID), not generated here, specifically so a device that buffered
// scans while offline can safely retry every buffered scan on reconnect --
// a retried event_id resolves to the SAME biometric_events row (unique on
// device_id+event_id) rather than creating a duplicate or double-marking
// attendance. This is what lets an offline-capable device/kiosk sync
// safely without needing this function to track per-device sync cursors.
//
// Dispatch for student notifications deliberately differs from
// send-communication/index.ts (which waits for a staff member with
// communication.write to visit the Communication page -- see its own
// header comment, no pg_cron/pg_net wiring exists yet): a gate scan has no
// staff session behind it, so this function queues the notification_logs
// row AND immediately attempts delivery itself via the same _shared/sms
// provider module -- not a second SMS integration, a second caller of the
// same one. Staff events are never messaged to anyone; there's no
// "notify someone about a staff check-in" requirement.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { getSmsProvider } from "../_shared/sms/index.ts";

type EventType = "check_in" | "check_out";
type VerificationResult =
  | "success"
  | "failed"
  | "unknown_credential"
  | "revoked_credential"
  | "inactive_profile";

interface ScanRequestBody {
  event_id?: string;
  result?: VerificationResult;
  credential_reference?: string;
  event_type?: EventType;
  occurred_at?: string;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function renderPlaceholders(body: string, values: Record<string, string>): string {
  let result = body;
  for (const [key, value] of Object.entries(values)) result = result.replaceAll(`{{${key}}}`, value);
  return result;
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // --- Device authentication (identical pattern to api-v1's api_keys) ---
  const authHeader = req.headers.get("authorization") ?? "";
  const rawKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!rawKey || !rawKey.includes(".")) return json({ error: "Missing or malformed device key." }, 401);
  const [keyPrefix, secret] = rawKey.split(/\.(.*)/s);
  if (!keyPrefix || !secret) return json({ error: "Malformed device key." }, 401);

  const { data: device } = await supabase
    .from("biometric_devices")
    .select("id, school_id, name, api_key_hash, status")
    .eq("api_key_prefix", keyPrefix)
    .maybeSingle();
  if (!device) return json({ error: "Unknown device." }, 401);
  if (device.status !== "active") return json({ error: "This device has been deactivated." }, 401);
  const secretHash = await sha256Hex(secret);
  if (!device.api_key_hash || secretHash !== device.api_key_hash) return json({ error: "Invalid device key." }, 401);

  await supabase.from("biometric_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);

  // --- Parse payload ---
  let body: ScanRequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Request body must be JSON." }, 400);
  }
  const eventId = body.event_id;
  const result = body.result ?? "success";
  if (!eventId || typeof eventId !== "string") return json({ error: "event_id is required." }, 400);
  const validResults: VerificationResult[] = ["success", "failed", "unknown_credential", "revoked_credential", "inactive_profile"];
  if (!validResults.includes(result)) return json({ error: "Invalid result." }, 400);
  const occurredAt = body.occurred_at ? new Date(body.occurred_at) : new Date();
  if (Number.isNaN(occurredAt.getTime())) return json({ error: "occurred_at is not a valid timestamp." }, 400);

  const logVerification = (fields: { credential_reference?: string | null; profile_id?: string | null; result: VerificationResult }) =>
    supabase.from("biometric_verifications").insert({
      school_id: device.school_id,
      device_id: device.id,
      credential_reference: fields.credential_reference ?? null,
      profile_id: fields.profile_id ?? null,
      result: fields.result,
      occurred_at: occurredAt.toISOString(),
    });

  // --- Device-reported failure: log the attempt, nothing else to do ---
  if (result !== "success") {
    await logVerification({ credential_reference: body.credential_reference ?? null, result });
    return json({ success: true, verification: result, event_created: false });
  }

  // --- Successful local match: resolve credential -> profile -> person ---
  const { credential_reference, event_type } = body;
  if (!credential_reference) return json({ error: "credential_reference is required when result is 'success'." }, 400);
  if (event_type !== "check_in" && event_type !== "check_out") {
    return json({ error: "event_type must be 'check_in' or 'check_out' when result is 'success'." }, 400);
  }

  const { data: credential } = await supabase
    .from("biometric_credentials")
    .select("id, profile_id, status")
    .eq("device_id", device.id)
    .eq("credential_reference", credential_reference)
    .maybeSingle();

  if (!credential) {
    await logVerification({ credential_reference, result: "unknown_credential" });
    return json({ success: true, verification: "unknown_credential", event_created: false }, 404);
  }
  if (credential.status !== "active") {
    await logVerification({ credential_reference, profile_id: credential.profile_id, result: "revoked_credential" });
    return json({ success: true, verification: "revoked_credential", event_created: false }, 403);
  }

  const { data: profile } = await supabase
    .from("biometric_profiles")
    .select("id, person_type, person_id, status")
    .eq("id", credential.profile_id)
    .single();

  if (!profile || profile.status !== "active") {
    await logVerification({ credential_reference, profile_id: credential.profile_id, result: "inactive_profile" });
    return json({ success: true, verification: "inactive_profile", event_created: false }, 403);
  }

  // Person must still be active in their own record too -- a revoked
  // biometric_profiles.status is a manual toggle; a student/staff whose
  // own record went inactive (withdrawn, exited) shouldn't silently keep
  // producing attendance/notifications just because nobody separately
  // remembered to flip the biometric profile off.
  if (profile.person_type === "student") {
    const { data: student } = await supabase.from("students").select("status").eq("id", profile.person_id).maybeSingle();
    if (!student || student.status !== "active") {
      await logVerification({ credential_reference, profile_id: profile.id, result: "inactive_profile" });
      return json({ success: true, verification: "inactive_profile", event_created: false }, 403);
    }
  } else {
    const { data: staff } = await supabase.from("school_users").select("status").eq("id", profile.person_id).maybeSingle();
    if (!staff || staff.status !== "active") {
      await logVerification({ credential_reference, profile_id: profile.id, result: "inactive_profile" });
      return json({ success: true, verification: "inactive_profile", event_created: false }, 403);
    }
  }

  const { data: verification, error: verificationError } = await logVerification({
    credential_reference,
    profile_id: profile.id,
    result: "success",
  }).select("id").single();
  if (verificationError) console.error(verificationError);

  // --- Idempotent event write: a retried offline-buffered scan resolves
  // to the same row instead of creating a duplicate. ---
  const { data: newEvent, error: eventInsertError } = await supabase
    .from("biometric_events")
    .insert({
      school_id: device.school_id,
      event_id: eventId,
      device_id: device.id,
      profile_id: profile.id,
      person_type: profile.person_type,
      person_id: profile.person_id,
      event_type,
      occurred_at: occurredAt.toISOString(),
      verification_id: verification?.id ?? null,
    })
    .select("id")
    .single();

  let biometricEvent = newEvent;
  let isReplay = false;
  if (eventInsertError) {
    if (eventInsertError.code === "23505") {
      isReplay = true;
      const { data: existing } = await supabase
        .from("biometric_events")
        .select("id, attendance_table, attendance_id, notification_status")
        .eq("device_id", device.id)
        .eq("event_id", eventId)
        .single();
      biometricEvent = existing ?? null;
    } else {
      console.error(eventInsertError);
      return json({ error: "Failed to record the event." }, 500);
    }
  }
  if (!biometricEvent) return json({ error: "Failed to record the event." }, 500);

  if (isReplay) {
    // Already fully processed (attendance + notification) the first time
    // this event_id was seen -- return the same outcome, do nothing twice.
    return json({ success: true, verification: "success", event_created: false, replay: true, event_id: biometricEvent.id });
  }

  // --- Feed the EXISTING attendance module. Biometrics only answers "who
  // and when"; the rules for what that means for attendance stay exactly
  // where they already live. ---
  let attendanceTable: string | null = null;
  let attendanceId: string | null = null;
  const attendanceDate = occurredAt.toISOString().slice(0, 10);

  if (profile.person_type === "student" && event_type === "check_in") {
    const { data: student } = await supabase.from("students").select("current_class_id").eq("id", profile.person_id).single();
    if (student?.current_class_id) {
      const { data: inserted, error: insertErr } = await supabase
        .from("student_attendance")
        .insert({
          school_id: device.school_id,
          student_id: profile.person_id,
          stream_id: student.current_class_id,
          attendance_date: attendanceDate,
          status: "present",
          session: "gate",
        })
        .select("id")
        .single();
      if (inserted) {
        attendanceTable = "student_attendance";
        attendanceId = inserted.id;
      } else if (insertErr?.code === "23505") {
        // Already marked present at the gate today (e.g. a second check_in) --
        // do not touch the existing row, manual or otherwise.
        const { data: existingRow } = await supabase
          .from("student_attendance")
          .select("id")
          .eq("student_id", profile.person_id)
          .eq("attendance_date", attendanceDate)
          .eq("session", "gate")
          .maybeSingle();
        attendanceTable = "student_attendance";
        attendanceId = existingRow?.id ?? null;
      } else if (insertErr) {
        console.error(insertErr);
      }
    }
  } else if (profile.person_type === "staff") {
    const timeLabel = occurredAt.toISOString().slice(11, 19); // HH:MM:SS
    const { data: existingRow } = await supabase
      .from("staff_attendance")
      .select("id, check_in_time, check_out_time")
      .eq("staff_id", profile.person_id)
      .eq("attendance_date", attendanceDate)
      .maybeSingle();

    if (!existingRow) {
      const { data: inserted, error: insertErr } = await supabase
        .from("staff_attendance")
        .insert({
          school_id: device.school_id,
          staff_id: profile.person_id,
          attendance_date: attendanceDate,
          status: "present",
          check_in_time: event_type === "check_in" ? timeLabel : null,
          check_out_time: event_type === "check_out" ? timeLabel : null,
          biometric_event_id: biometricEvent.id,
        })
        .select("id")
        .single();
      if (!insertErr && inserted) {
        attendanceTable = "staff_attendance";
        attendanceId = inserted.id;
      } else if (insertErr) {
        console.error(insertErr);
      }
    } else {
      // Row already exists for today (manual or biometric). Only fill in
      // whichever time field is still empty -- never overwrite a value
      // that's already there, biometric or manually entered.
      const patch: Record<string, unknown> = { biometric_event_id: biometricEvent.id };
      if (event_type === "check_in" && !existingRow.check_in_time) patch.check_in_time = timeLabel;
      if (event_type === "check_out" && !existingRow.check_out_time) patch.check_out_time = timeLabel;
      await supabase.from("staff_attendance").update(patch).eq("id", existingRow.id);
      attendanceTable = "staff_attendance";
      attendanceId = existingRow.id;
    }
  }
  // student check_out: intentionally does not touch student_attendance --
  // the 'gate' session row from check_in already recorded presence for the
  // day; there is no "left early" status in the existing status enum, so
  // that stays a biometric_events-only record plus a guardian notification.

  // --- Guardian notification: students only. ---
  let notificationStatus: string = "not_applicable";
  let notificationLogId: string | null = null;

  if (profile.person_type === "student") {
    const { data: student } = await supabase.from("students").select("first_name, last_name").eq("id", profile.person_id).maybeSingle();
    const { data: school } = await supabase.from("schools").select("name").eq("id", device.school_id).single();
    const { data: guardians } = await supabase
      .from("student_guardians")
      .select("guardian_user_id, guardian:school_users(id, phone)")
      .eq("student_id", profile.person_id);

    const recipients = (guardians ?? [])
      .map((g) => g.guardian as unknown as { id: string; phone: string | null } | null)
      .filter((su): su is { id: string; phone: string } => !!su?.phone);

    if (recipients.length === 0) {
      notificationStatus = "skipped";
    } else {
      const studentName = student ? `${student.first_name} ${student.last_name}` : "Student";
      const schoolName = school?.name ?? "School";
      const timeLabel = occurredAt.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: true });

      const { data: templates } = await supabase
        .from("communication_templates")
        .select("id, name, body")
        .eq("school_id", device.school_id)
        .eq("category", "gate_attendance")
        .eq("channel", "sms");
      const hints = event_type === "check_in" ? ["check-in", "checkin", "arrival"] : ["check-out", "checkout", "departure"];
      const matchedTemplate =
        (templates ?? []).find((t) => hints.some((h) => t.name.toLowerCase().includes(h))) ?? (templates ?? [])[0] ?? null;
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
      let anySent = false;
      let anySkipped = 0;

      for (const recipient of recipients) {
        const { data: pref } = await supabase
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

        const { data: logRow } = await supabase
          .from("notification_logs")
          .insert({
            school_id: device.school_id,
            student_id: profile.person_id,
            recipient_phone: recipient.phone,
            recipient_type: "guardian",
            recipient_school_user_id: recipient.id,
            channel: "sms",
            template_id: matchedTemplate?.id ?? null,
            body: renderedBody,
            segments: Math.max(1, Math.ceil(renderedBody.length / 160)),
            sent_by: null,
            source_module: "biometric",
          })
          .select("id")
          .single();
        if (!logRow) continue;
        notificationLogId = logRow.id;

        try {
          await smsProvider.send(recipient.phone, renderedBody);
          await supabase.from("notification_logs").update({ status: "sent", updated_at: new Date().toISOString() }).eq("id", logRow.id);
          anySent = true;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await supabase
            .from("notification_logs")
            .update({ status: "failed", provider_response: message.slice(0, 500), updated_at: new Date().toISOString() })
            .eq("id", logRow.id);
        }
      }
      notificationStatus = anySkipped === recipients.length ? "skipped" : anySent ? "sent" : "failed";
    }
  }

  await supabase
    .from("biometric_events")
    .update({
      attendance_table: attendanceTable,
      attendance_id: attendanceId,
      notification_status: notificationStatus,
      notification_log_id: notificationLogId,
    })
    .eq("id", biometricEvent.id);

  return json({
    success: true,
    verification: "success",
    event_created: true,
    event_id: biometricEvent.id,
    attendance: attendanceTable ? { table: attendanceTable, id: attendanceId } : null,
    notification: notificationStatus,
  });
});
