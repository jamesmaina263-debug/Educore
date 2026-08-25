import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseAttlogBody, parseOperlogUserBody, statusToEventType, buildDeterministicEventId, parseDeviceTime } from "@/lib/biometric/zkteco";
import { notifyGuardianOfGateEvent } from "@/lib/biometric/notifyGuardian";

// ZKTeco (and most ADMS-protocol) attendance terminals are hardcoded to
// call exactly this path -- /iclock/cdata -- relative to whatever
// "Server Address"/"Server Port" is configured in the device's own menu.
// Classic consumer models (the K40-class terminal recommended for this
// integration) do NOT let you configure a custom path or a sub-domain
// prefix, which is why this lives as a literal Next.js route on EduCore's
// own Vercel domain rather than as a Supabase Edge Function -- Edge
// Functions are only reachable under /functions/v1/<name>, a path prefix
// no cheap consumer terminal lets you add.
//
// Auth is SN (device serial number) + an optional comm_key query param --
// see biometric_devices.comm_key's column comment for why this is a
// deliberately separate, weaker model than biometric-verify's bearer
// token: these devices' menus don't support custom Authorization headers.
//
// UNVERIFIED AGAINST REAL HARDWARE. See zkteco.ts's header comment.
// Duplicates (rather than shares) biometric-verify's credential/profile/
// attendance-write logic on purpose -- see this session's design notes:
// coupling the proven bearer-token path to this unproven push-protocol
// path risked regressing something already deployed and live-tested.
// Guardian SMS on a student check-in is now wired in too, via
// notifyGuardianOfGateEvent -- a deliberate duplicate of
// biometric-verify's own notification block (Deno Edge Function vs. this
// Vercel Route Handler can't share a module without a build-tooling
// change neither side has). Still unverified against real hardware: SMS
// send success/failure hasn't been observed with a real device push,
// only reasoned about from the same logic that's already live-tested on
// the kiosk path.

export const dynamic = "force-dynamic";

interface AuthedDevice {
  id: string;
  school_id: string;
  device_type: string;
}

async function authenticateBySerial(
  admin: ReturnType<typeof createAdminClient>,
  serialNumber: string | null,
  commKeyParam: string | null,
): Promise<{ device: AuthedDevice } | { error: string; status: number }> {
  if (!serialNumber) return { error: "SN is required.", status: 400 };

  const { data: device } = await admin
    .from("biometric_devices")
    .select("id, school_id, device_type, status, provider, comm_key")
    .eq("serial_number", serialNumber)
    .eq("provider", "zkteco")
    .maybeSingle();

  if (!device) return { error: "Unregistered device serial number.", status: 401 };
  if (device.status !== "active") return { error: "This device has been deactivated.", status: 401 };
  if (device.comm_key && device.comm_key !== commKeyParam) return { error: "Invalid comm key.", status: 401 };

  await admin.from("biometric_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);
  return { device: { id: device.id, school_id: device.school_id, device_type: device.device_type } };
}

// --- GET: device registration/heartbeat handshake ---
// A real device polls this periodically (not just once at boot) with
// ?options=all and expects this exact plain-text key=value block back, or
// it won't proceed to push attendance data. Field values here (Realtime=1,
// TransFlag listing AttLog + user-enrollment pushes) are what ask the
// device to push in real time rather than only on a manual sync.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sn = url.searchParams.get("SN");
  const commKey = url.searchParams.get("commkey") ?? url.searchParams.get("pushcommkey");

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : "Server not configured.", { status: 500 });
  }

  const auth = await authenticateBySerial(admin, sn, commKey);
  if ("error" in auth) return new NextResponse(auth.error, { status: auth.status });

  const body = [
    `GET OPTION FROM: ${sn}`,
    "ATTLOGStamp=None",
    "OPERLOGStamp=None",
    "ATTPHOTOStamp=None",
    "ErrorDelay=30",
    "Delay=10",
    "TransTimes=00:00;23:59",
    "TransInterval=1",
    "TransFlag=TransData AttLog OpLog EnrollUser ChgUser EnrollFP ChgFP",
    "Realtime=1",
    "Encrypt=None",
  ].join("\n");

  return new NextResponse(body, { status: 200, headers: { "Content-Type": "text/plain" } });
}

// --- POST: ATTLOG (attendance) and OPERLOG/USER (enrollment) pushes ---
export async function POST(request: Request) {
  const url = new URL(request.url);
  const sn = url.searchParams.get("SN");
  const table = (url.searchParams.get("table") ?? "").toUpperCase();
  const commKey = url.searchParams.get("commkey") ?? url.searchParams.get("pushcommkey");

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : "Server not configured.", { status: 500 });
  }

  const auth = await authenticateBySerial(admin, sn, commKey);
  if ("error" in auth) return new NextResponse(auth.error, { status: auth.status });
  const { device } = auth;

  const rawBody = await request.text();

  // Registration ping some firmwares send as a zero-length POST before
  // ever pushing real data -- just acknowledge it.
  if (table === "OPTIONS" || !rawBody.trim()) {
    return new NextResponse("OK", { status: 200 });
  }

  if (table === "ATTLOG") {
    const { records, skipped } = parseAttlogBody(rawBody);
    if (skipped.length > 0) {
      console.warn(`[iclock/cdata] ${skipped.length} unparseable ATTLOG line(s) from SN=${sn}:`, skipped);
    }

    let processed = 0;
    let failed = 0;
    for (const record of records) {
      const outcome = await processAttendanceRecord(admin, device, sn!, record);
      if (outcome.ok) {
        processed++;
      } else {
        failed++;
        console.error(`[iclock/cdata] ATTLOG record failed for SN=${sn} PIN=${record.pin}:`, outcome.error);
      }
    }
    if (failed > 0) console.warn(`[iclock/cdata] SN=${sn}: ${processed} record(s) processed, ${failed} failed.`);

    return new NextResponse("OK", { status: 200 });
  }

  if (table === "OPERLOG" || table === "USER") {
    const { records, skipped } = parseOperlogUserBody(rawBody);
    if (skipped.length > 0) {
      console.warn(`[iclock/cdata] ${skipped.length} unparseable ${table} line(s) from SN=${sn}:`, skipped);
    }

    for (const record of records) {
      // One live pending row per (device, pin) -- see the unique index in
      // the migration. A re-push (the device re-syncing the same user)
      // updates raw_payload/updated_at instead of piling up duplicates,
      // and does NOT touch a row that's already been linked or ignored --
      // an admin's decision on a specific enrollment isn't silently
      // reopened just because the device pushed the same user info again.
      const { error } = await admin
        .from("biometric_enrollment_events")
        .upsert(
          {
            school_id: device.school_id,
            device_id: device.id,
            provider_user_id: record.pin,
            provider_user_name: record.name,
            raw_payload: { raw: record.raw },
            status: "pending",
          },
          { onConflict: "device_id,provider_user_id,status" },
        );
      if (error) console.error(`[iclock/cdata] failed to stage enrollment for SN=${sn} PIN=${record.pin}:`, error);
    }

    return new NextResponse("OK", { status: 200 });
  }

  // Unknown table -- ack anyway so the device doesn't retry forever; log
  // for investigation since this may mean a payload shape this adapter
  // doesn't handle yet.
  console.warn(`[iclock/cdata] unhandled table="${table}" from SN=${sn}, body:`, rawBody.slice(0, 500));
  return new NextResponse("OK", { status: 200 });
}

async function processAttendanceRecord(
  admin: ReturnType<typeof createAdminClient>,
  device: AuthedDevice,
  serialNumber: string,
  record: { pin: string; time: string; status: string | null; verify: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const occurredAt = parseDeviceTime(record.time);
  if (Number.isNaN(occurredAt.getTime())) return { ok: false, error: `unparseable time "${record.time}"` };

  const { eventType, ambiguous } = statusToEventType(record.status);
  if (ambiguous) {
    console.warn(`[iclock/cdata] ambiguous Status="${record.status}" for SN=${serialNumber} PIN=${record.pin} -- defaulting to check_in`);
  }

  const { data: credential } = await admin
    .from("biometric_credentials")
    .select("id, profile_id, status")
    .eq("device_id", device.id)
    .eq("credential_reference", record.pin)
    .maybeSingle();

  const logVerification = (fields: { profile_id?: string | null; result: string }) =>
    admin.from("biometric_verifications").insert({
      school_id: device.school_id,
      device_id: device.id,
      credential_reference: record.pin,
      profile_id: fields.profile_id ?? null,
      result: fields.result,
      occurred_at: occurredAt.toISOString(),
    });

  if (!credential) {
    await logVerification({ result: "unknown_credential" });
    return { ok: false, error: "unknown_credential (PIN not enrolled in EduCore yet -- see Pending Enrollments)" };
  }
  if (credential.status !== "active") {
    await logVerification({ profile_id: credential.profile_id, result: "revoked_credential" });
    return { ok: false, error: "revoked_credential" };
  }

  const { data: profile } = await admin
    .from("biometric_profiles")
    .select("id, person_type, person_id, status")
    .eq("id", credential.profile_id)
    .single();
  if (!profile || profile.status !== "active") {
    await logVerification({ profile_id: credential.profile_id, result: "inactive_profile" });
    return { ok: false, error: "inactive_profile" };
  }

  if (profile.person_type === "student") {
    const { data: student } = await admin.from("students").select("status").eq("id", profile.person_id).maybeSingle();
    if (!student || student.status !== "active") {
      await logVerification({ profile_id: profile.id, result: "inactive_profile" });
      return { ok: false, error: "inactive_profile (student record)" };
    }
  } else {
    const { data: staff } = await admin.from("school_users").select("status").eq("id", profile.person_id).maybeSingle();
    if (!staff || staff.status !== "active") {
      await logVerification({ profile_id: profile.id, result: "inactive_profile" });
      return { ok: false, error: "inactive_profile (staff record)" };
    }
  }

  const { data: verification } = await logVerification({ profile_id: profile.id, result: "success" }).select("id").single();

  const eventId = buildDeterministicEventId(serialNumber, record);
  const { data: newEvent, error: eventInsertError } = await admin
    .from("biometric_events")
    .insert({
      school_id: device.school_id,
      event_id: eventId,
      device_id: device.id,
      profile_id: profile.id,
      person_type: profile.person_type,
      person_id: profile.person_id,
      event_type: eventType,
      occurred_at: occurredAt.toISOString(),
      verification_id: verification?.id ?? null,
    })
    .select("id")
    .single();

  const biometricEventId = newEvent?.id ?? null;
  if (eventInsertError) {
    if (eventInsertError.code === "23505") {
      // Same (device, pin, time, status) already processed -- the device
      // re-pushed it (retry after a slow ack, or a manual re-sync).
      // Nothing further to do; this is the whole point of a deterministic
      // event_id.
      return { ok: true };
    }
    return { ok: false, error: eventInsertError.message };
  }
  if (!biometricEventId) return { ok: false, error: "event insert returned no id" };

  let attendanceTable: string | null = null;
  let attendanceId: string | null = null;
  const attendanceDate = occurredAt.toISOString().slice(0, 10);

  let gateThresholds: { gate_late_after_student: string | null; gate_late_after_staff: string | null } | null = null;
  async function loadGateThresholds() {
    if (gateThresholds) return gateThresholds;
    const { data } = await admin
      .from("schools")
      .select("gate_late_after_student, gate_late_after_staff")
      .eq("id", device.school_id)
      .single();
    gateThresholds = data ?? { gate_late_after_student: null, gate_late_after_staff: null };
    return gateThresholds;
  }
  function resolveGateStatus(threshold: string | null): "present" | "late" {
    if (!threshold) return "present";
    return occurredAt.toISOString().slice(11, 19) > threshold ? "late" : "present";
  }

  if (profile.person_type === "student" && eventType === "check_in") {
    const { data: student } = await admin.from("students").select("current_class_id").eq("id", profile.person_id).single();
    if (student?.current_class_id) {
      const thresholds = await loadGateThresholds();
      const { data: inserted, error: insertErr } = await admin
        .from("student_attendance")
        .insert({
          school_id: device.school_id,
          student_id: profile.person_id,
          stream_id: student.current_class_id,
          attendance_date: attendanceDate,
          status: resolveGateStatus(thresholds.gate_late_after_student),
          session: "gate",
        })
        .select("id")
        .single();
      if (inserted) {
        attendanceTable = "student_attendance";
        attendanceId = inserted.id;
      } else if (insertErr?.code === "23505") {
        const { data: existingRow } = await admin
          .from("student_attendance")
          .select("id")
          .eq("student_id", profile.person_id)
          .eq("attendance_date", attendanceDate)
          .eq("session", "gate")
          .maybeSingle();
        attendanceTable = "student_attendance";
        attendanceId = existingRow?.id ?? null;
      }
    }
  } else if (profile.person_type === "staff") {
    const timeLabel = occurredAt.toISOString().slice(11, 19);
    const { data: existingRow } = await admin
      .from("staff_attendance")
      .select("id, check_in_time, check_out_time")
      .eq("staff_id", profile.person_id)
      .eq("attendance_date", attendanceDate)
      .maybeSingle();

    if (!existingRow) {
      const thresholds = await loadGateThresholds();
      const { data: inserted } = await admin
        .from("staff_attendance")
        .insert({
          school_id: device.school_id,
          staff_id: profile.person_id,
          attendance_date: attendanceDate,
          status: eventType === "check_in" ? resolveGateStatus(thresholds.gate_late_after_staff) : "present",
          check_in_time: eventType === "check_in" ? timeLabel : null,
          check_out_time: eventType === "check_out" ? timeLabel : null,
          biometric_event_id: biometricEventId,
        })
        .select("id")
        .single();
      if (inserted) {
        attendanceTable = "staff_attendance";
        attendanceId = inserted.id;
      }
    } else {
      const patch: Record<string, unknown> = { biometric_event_id: biometricEventId };
      if (eventType === "check_in" && !existingRow.check_in_time) patch.check_in_time = timeLabel;
      if (eventType === "check_out" && !existingRow.check_out_time) patch.check_out_time = timeLabel;
      await admin.from("staff_attendance").update(patch).eq("id", existingRow.id);
      attendanceTable = "staff_attendance";
      attendanceId = existingRow.id;
    }
  }

  // Guardian notification: students only, same as biometric-verify.
  // Wrapped separately from the attendance write above -- attendance has
  // already been recorded by this point, and a bug in the notify path
  // (a bad template, an SMS provider outage, etc.) should not turn an
  // already-successful attendance record into a failed ATTLOG record.
  let notificationStatus: string = "not_applicable";
  let notificationLogId: string | null = null;
  if (profile.person_type === "student") {
    try {
      const result = await notifyGuardianOfGateEvent(admin, {
        schoolId: device.school_id,
        studentId: profile.person_id,
        eventType,
        occurredAt,
        sourceModule: "biometric",
      });
      notificationStatus = result.status;
      notificationLogId = result.logId;
    } catch (err) {
      console.error(`[iclock/cdata] guardian notification failed for SN=${serialNumber} PIN=${record.pin}:`, err);
      notificationStatus = "failed";
    }
  }

  await admin
    .from("biometric_events")
    .update({
      attendance_table: attendanceTable,
      attendance_id: attendanceId,
      notification_status: notificationStatus,
      notification_log_id: notificationLogId,
    })
    .eq("id", biometricEventId);

  return { ok: true };
}
