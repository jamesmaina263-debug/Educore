"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { dispatchQueuedCommunications } from "@/lib/dispatch-communications-client";
import {
  describeAlertResult,
  isBoardingKind,
  isBusAlertMode,
  isUuid,
  mapBusAlertError,
  parseAlertResult,
  validateDelay,
  validatePhone,
  cleanPhone,
  type BoardingKind,
  type BusAlertMode,
} from "@/lib/bus-alerts";

// WP 5.4 + 5.5: staff actions for guardian bus alerts. Thin wrappers over the database functions, which check the
// permission (transport.write), the feature flag, the school's mode (off / test / live), opt-outs and quiet hours
// themselves. In test mode the database queues ONE message to the staff test phone and none to a guardian.
//
// Sending: the scheduled sweep of queued messages runs only once a day, so a bus alert would arrive hours late. After
// queuing, this dispatches immediately. If the immediate send fails, the still-queued alert is CANCELLED
// (cancel_unsent_bus_alerts) instead of being left for the daily sweep, so a stale "the bus is late" never reaches a
// parent tomorrow. Staff are told plainly when that happens.

export type BusActionResult = { error: string } | { success: true; message: string; warning?: boolean };

const NOT_SENT = "The message could not be sent right now, so it was cancelled instead of being sent late. Please try again.";

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function start(): Promise<{ supabase: Supabase } | { error: string }> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };
  return { supabase };
}

/** Sends what was just queued. Returns the number sent, or null if the sweep could not be reached (and cancels). */
async function dispatchOrCancel(supabase: Supabase, queued: number): Promise<{ ok: true; sent: number | null } | { ok: false }> {
  if (queued <= 0) return { ok: true, sent: 0 };
  let failed = false;
  let sent: number | null = null;
  try {
    const res = await dispatchQueuedCommunications();
    if (res.error) failed = true;
    else sent = typeof res.data?.sent === "number" ? res.data.sent : null;
  } catch {
    failed = true;
  }
  if (failed) {
    try {
      await supabase.rpc("cancel_unsent_bus_alerts");
    } catch {
      /* the daily sweep is the only fallback; nothing more can be done here */
    }
    return { ok: false };
  }
  return { ok: true, sent };
}

export async function saveBusAlertMode(input: { mode: BusAlertMode; testPhone: string | null }): Promise<BusActionResult> {
  if (!input || !isBusAlertMode(input.mode)) return { error: "Choose a mode." };
  const phoneProblem = validatePhone(input.testPhone);
  if (phoneProblem) return { error: phoneProblem };
  const s = await start();
  if ("error" in s) return s;
  const { error } = await s.supabase.rpc("set_bus_alert_mode", { p_mode: input.mode, p_test_phone: cleanPhone(input.testPhone) });
  if (error) {
    if (error.code === "22023") return { error: error.message.startsWith("Send a test") || error.message.startsWith("Set a staff") ? error.message : mapBusAlertError("22023") };
    return { error: mapBusAlertError(error.code) };
  }
  revalidatePath("/transport/alerts");
  return { success: true, message: `Bus alerts are now ${input.mode}.` };
}

export async function sendTestBusAlert(): Promise<BusActionResult> {
  const s = await start();
  if ("error" in s) return s;
  const { error } = await s.supabase.rpc("send_bus_test_alert");
  if (error) {
    if (error.code === "22023") return { error: "Set a staff test phone and switch to test mode first." };
    return { error: mapBusAlertError(error.code) };
  }
  const d = await dispatchOrCancel(s.supabase, 1);
  revalidatePath("/transport/alerts");
  if (!d.ok) return { error: NOT_SENT };
  return { success: true, message: "Test alert sent to your test phone. If you received it, you can switch to live." };
}

export async function sendDelayAlert(input: { routeId: string; minutes: number; note: string | null }): Promise<BusActionResult> {
  if (!input || !isUuid(input.routeId)) return { error: "Choose a route." };
  const problem = validateDelay(input.minutes, input.note);
  if (problem) return { error: problem };
  const s = await start();
  if ("error" in s) return s;
  const { data, error } = await s.supabase.rpc("send_bus_delay_alert", { p_route_id: input.routeId, p_minutes: input.minutes, p_note: (input.note ?? "").trim() || null });
  if (error) return { error: mapBusAlertError(error.code) };
  const r = parseAlertResult(data);
  if (!r) return { error: "The alert may not have been sent. Please check the alert log." };
  const d = await dispatchOrCancel(s.supabase, r.queued);
  revalidatePath("/transport/alerts");
  if (!d.ok) return { error: NOT_SENT };
  return { success: true, message: describeAlertResult("delay", r, d.sent) };
}

export async function recordBusBoarding(input: { studentId: string; kind: BoardingKind }): Promise<BusActionResult> {
  if (!input || !isUuid(input.studentId) || !isBoardingKind(input.kind)) return { error: "Choose a learner." };
  const s = await start();
  if ("error" in s) return s;
  const { data, error } = await s.supabase.rpc("record_bus_boarding", { p_student_id: input.studentId, p_kind: input.kind, p_vehicle_id: null });
  if (error) return { error: mapBusAlertError(error.code) };
  const r = parseAlertResult(data);
  if (!r) return { error: "The event may not have been recorded. Please check the roll-call list." };
  const d = await dispatchOrCancel(s.supabase, r.queued);
  revalidatePath("/transport/alerts");
  if (!d.ok) {
    return { success: true, warning: true, message: `${input.kind === "boarded" ? "Boarding" : "Drop-off"} was recorded, but the guardian message could not be sent right now and was cancelled instead of being sent late.` };
  }
  return { success: true, message: describeAlertResult(input.kind, r, d.sent) };
}
