// Parsing and auth-check logic for the ZKTeco ADMS push protocol,
// kept pure (no Supabase calls) so it can actually be unit-tested --
// unlike supabase/functions/*, which run on Deno and are excluded from
// this project's tsc/eslint/vitest entirely.
//
// IMPORTANT -- this is the single highest-risk unverified area of the
// whole biometric module. ADMS is not an officially published protocol;
// every source is reverse-engineering/community documentation, and they
// disagree with each other on exact formatting (see the two ATTLOG
// variants below). This has never been run against a real device. Before
// trusting it in production: capture a real device's actual raw POST
// body (log it, don't just parse-and-discard) and compare it against
// parseAttlogBody's assumptions, and confirm what Status codes THAT
// specific device/firmware actually sends for check-in vs check-out --
// they're configurable per device and not guaranteed to be 0/1.

export interface AttlogRecord {
  pin: string;
  time: string; // "YYYY-MM-DD HH:MM:SS", device-local wall clock, not necessarily UTC
  status: string | null;
  verify: string | null;
  raw: string; // the original line, kept for logging when a record can't be confidently parsed further
}

/**
 * Parses an ADMS ATTLOG push body. Handles both formats found in the wild:
 *  - Positional, tab-separated (the format documented in ZKTeco's own
 *    "Attendance PUSH Communication Protocol" spec):
 *      PIN\tTIME\tSTATUS\tVERIFY\tWORKCODE\tRESERVED\tRESERVED
 *  - key=value pairs on one line (seen in some community integrations):
 *      PIN=1001 DateTime=2025-09-02 14:32:11 Verified=1 Status=0
 * Unrecognized lines are skipped, not thrown -- one malformed line
 * (e.g. mid-write truncation) shouldn't lose every other record in the
 * same push. Callers should log skipped lines for later investigation.
 */
export function parseAttlogBody(body: string): { records: AttlogRecord[]; skipped: string[] } {
  const records: AttlogRecord[] = [];
  const skipped: string[] = [];

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.includes("=")) {
      const pinMatch = line.match(/\bPIN=(\S+)/i);
      const timeMatch = line.match(/\bDateTime=(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/i);
      const statusMatch = line.match(/\bStatus=(\S+)/i);
      const verifyMatch = line.match(/\bVerified?=(\S+)/i);
      if (pinMatch && timeMatch) {
        records.push({
          pin: pinMatch[1],
          time: timeMatch[1],
          status: statusMatch?.[1] ?? null,
          verify: verifyMatch?.[1] ?? null,
          raw: line,
        });
        continue;
      }
      skipped.push(line);
      continue;
    }

    const fields = line.split("\t");
    if (fields.length >= 2 && fields[0] && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(fields[1] ?? "")) {
      records.push({
        pin: fields[0],
        time: fields[1].replace("T", " "),
        status: fields[2] || null,
        verify: fields[3] || null,
        raw: line,
      });
      continue;
    }

    skipped.push(line);
  }

  return { records, skipped };
}

export interface OperlogUserRecord {
  pin: string;
  name: string | null;
  raw: string;
}

/**
 * Parses an OPERLOG/USER push -- a device telling us a user was
 * enrolled/changed locally. Only PIN and Name are extracted; nothing else
 * on the line (including any fingerprint/template data ZKTeco's protocol
 * may also carry in this push) is read or stored anywhere -- see
 * biometric_enrollment_events' table comment for why even PIN+Name lands
 * in a staged, human-reviewed table rather than creating a credential
 * directly.
 */
export function parseOperlogUserBody(body: string): { records: OperlogUserRecord[]; skipped: string[] } {
  const records: OperlogUserRecord[] = [];
  const skipped: string[] = [];

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const pinMatch = line.match(/\bPIN=(\S+)/i);
    if (!pinMatch) {
      skipped.push(line);
      continue;
    }
    const nameMatch = line.match(/\bName=([^\t]+?)(?:\s+\w+=|$)/i);
    records.push({ pin: pinMatch[1], name: nameMatch?.[1]?.trim() || null, raw: line });
  }

  return { records, skipped };
}

/**
 * Status -> event_type. 0/present-like codes commonly mean check-in and
 * 1 commonly means check-out, but this is a per-device CONFIGURABLE
 * convention on real ZKTeco hardware, not a protocol guarantee -- a school
 * could reprogram their device's status codes. Defaults to check_in with
 * `ambiguous: true` for anything not recognized, rather than silently
 * guessing wrong on a value that actually meant check-out.
 */
export function statusToEventType(status: string | null): { eventType: "check_in" | "check_out"; ambiguous: boolean } {
  if (status === "1" || status === "5") return { eventType: "check_out", ambiguous: false };
  if (status === "0" || status === "4") return { eventType: "check_in", ambiguous: false };
  return { eventType: "check_in", ambiguous: true };
}

/**
 * Builds the deterministic event_id ADMS itself never supplies. Same
 * (device, pin, time, status) always yields the same id, so a device
 * retrying a push after a slow/dropped ack lands on the SAME
 * biometric_events row (unique on device_id+event_id) instead of a
 * duplicate -- the same idempotency guarantee biometric-verify gets from
 * its caller-supplied event_id, just synthesized here instead.
 */
export function buildDeterministicEventId(serialNumber: string, record: Pick<AttlogRecord, "pin" | "time" | "status">): string {
  return `zkteco:${serialNumber}:${record.pin}:${record.time}:${record.status ?? ""}`;
}

/** "YYYY-MM-DD HH:MM:SS" (device-local wall clock, per the protocol) -> a Date. Devices don't send a timezone; treated as UTC digits, matching biometric-verify's own existing wall-clock convention (see its resolveGateStatus comment) rather than inventing a second one here. */
export function parseDeviceTime(time: string): Date {
  return new Date(`${time.replace(" ", "T")}Z`);
}
