// Client for the biometric gate kiosk -- talks directly to the
// biometric-verify Edge Function using a device key, NOT a Supabase Auth
// session. A kiosk is a device, not a logged-in staff member, so none of
// this goes through a Next.js Server Action (those run against the
// caller's session cookie, which a kiosk doesn't have and shouldn't need --
// it should keep working unattended long after any staff member's session
// that paired it has expired).
//
// This is why "reuse the existing offline engine" here means reusing
// db.ts's IndexedDB stores and queue.ts's queue/sync primitives (both are
// already module-agnostic), but NOT handlers.ts's usual assumption that a
// handler is a Server Action -- the handler registered for this module is
// the plain fetch function below. See docs/OFFLINE_ROLLOUT.md, "Biometric
// gate kiosk" section, for the full reasoning.
//
// Zero biometric data ever passes through here: only credential_reference
// (an opaque ID the device/provider already issued during enrollment),
// event_type, occurred_at, result, and (test-only) dry_run. Same contract
// biometric-verify's own header comment documents.

export type VerificationResult = "success" | "failed" | "unknown_credential" | "revoked_credential" | "inactive_profile";
export type EventType = "check_in" | "check_out";

export interface RosterEntry {
  credential_reference: string;
  credential_type: "fingerprint" | "face";
  person_type: "student" | "staff";
  person_name: string;
}

export interface ScanPayload {
  device_key: string;
  event_id: string;
  result: VerificationResult;
  credential_reference?: string;
  event_type?: EventType;
  occurred_at: string;
  /** Testing aid, passed straight through to biometric-verify: skips the guardian SMS, nothing else. */
  dry_run?: boolean;
}

export type ScanOutcome =
  | { success: true; verification: VerificationResult; event_created: boolean; replay?: boolean; dry_run?: boolean }
  | { error: string };

export type RosterOutcome = { deviceName: string; roster: RosterEntry[] } | { error: string };

function functionsBase(): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`;
}

function deviceHeaders(deviceKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    Authorization: `Bearer ${deviceKey}`,
  };
}

/**
 * Validate a device key and fetch this device's roster in one call. Used
 * both to confirm pairing (unpaired -> paired) and to refresh the picker
 * list shown in the scan simulator. Callers should cache a successful
 * result (see kiosk-cache.ts) so the roster is still viewable -- not
 * scannable, viewable -- while offline.
 */
export async function fetchDeviceRoster(deviceKey: string): Promise<RosterOutcome> {
  try {
    const res = await fetch(`${functionsBase()}/biometric-verify`, {
      method: "GET",
      headers: deviceHeaders(deviceKey),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error ?? "Could not reach this device's roster." };
    return { deviceName: data.device?.name ?? "Biometric device", roster: data.roster ?? [] };
  } catch {
    return { error: "network" };
  }
}

/**
 * Submit one scan outcome. This is the function used BOTH for the live
 * online path and, unchanged, as the offline-replay handler registered in
 * handlers.ts -- so a queued-then-replayed scan hits the exact same Edge
 * Function call as a live one, same as every other module's pattern, just
 * via fetch() instead of a Server Action reference.
 */
export async function submitScan(payload: ScanPayload): Promise<ScanOutcome> {
  try {
    const res = await fetch(`${functionsBase()}/biometric-verify`, {
      method: "POST",
      headers: deviceHeaders(payload.device_key),
      body: JSON.stringify({
        event_id: payload.event_id,
        result: payload.result,
        credential_reference: payload.credential_reference,
        event_type: payload.event_type,
        occurred_at: payload.occurred_at,
        dry_run: payload.dry_run,
      }),
    });
    const data = await res.json();
    if (!res.ok && !data?.success) return { error: data.error ?? `Scan submission failed (${res.status}).` };
    return data as ScanOutcome;
  } catch (e) {
    // A network-level throw (device genuinely offline / DNS failure / etc.)
    // -- NOT a value the caller should treat as "failed", since
    // syncPendingMutations() specifically re-queues on TypeError and stops
    // the sync pass rather than burning through the rest of the queue
    // against a connection that isn't really there. Re-throw so that
    // behavior (shared with every other module) keeps working here too.
    if (e instanceof TypeError) throw e;
    return { error: e instanceof Error ? e.message : "Unknown error submitting scan." };
  }
}

function newEventId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `kiosk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Build a ScanPayload with a fresh locally-generated event_id -- the same ID is reused if this exact scan later gets retried from the offline queue. */
export function buildScanPayload(input: {
  deviceKey: string;
  result: VerificationResult;
  credentialReference?: string;
  eventType?: EventType;
  dryRun?: boolean;
}): ScanPayload {
  return {
    device_key: input.deviceKey,
    event_id: newEventId(),
    result: input.result,
    credential_reference: input.credentialReference,
    event_type: input.eventType,
    occurred_at: new Date().toISOString(),
    dry_run: input.dryRun,
  };
}
