"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { logAdminAction } from "@/lib/log-admin-action";
import { isUuid } from "@/lib/sales/pipeline";
import { NOTE_MAX, isManualRule, isNoteKind } from "@/lib/onboarding/onboarding";

type ActionResult = { error: string } | { success: true };

const PATH = "/admin/onboarding";
const MILESTONE_KEYS = ["password_changed", "email_verified", "first_login", "academic_year", "classes", "students", "fee_structures", "second_user"];

// School Onboarding & Engagement Monitor: team actions. Every mutation is a SECURITY DEFINER RPC that re-checks super
// admin and the rules itself (20261030063047_school_onboarding_monitor.sql); the validation here only gives friendlier
// first errors. Nothing here sends a message: a manual follow-up only PROPOSES an email into the existing trial
// message queue, where a person still approves the exact text and clicks Send. Audit detail carries ids and coded
// values only: never an address, a note's text, or message content.

function rpcInt(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export async function addOnboardingNote(input: { schoolId: string; kind: string; note: string; by: string }): Promise<ActionResult> {
  if (!isUuid(input.schoolId)) return { error: "Invalid school id." };
  if (!isUuid(input.by)) return { error: "Say who you are before adding a note." };
  if (!isNoteKind(input.kind)) return { error: "Choose what kind of note this is." };
  const note = input.note.trim();
  if (note.length === 0) return { error: "Write the note first." };
  if (note.length > NOTE_MAX) return { error: `A note can be at most ${NOTE_MAX} characters.` };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_add_onboarding_note", {
    p_school_id: input.schoolId,
    p_kind: input.kind,
    p_note: note,
    p_by: input.by,
  });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "add_onboarding_note", { school_id: input.schoolId, kind: input.kind });
  revalidatePath(`${PATH}/${input.schoolId}`);
  return { success: true };
}

export async function resolveOnboardingFollowup(input: { id: string; dismiss: boolean; by: string; schoolId?: string }): Promise<ActionResult> {
  if (!isUuid(input.id)) return { error: "Invalid follow-up id." };
  if (!isUuid(input.by)) return { error: "Say who you are before changing an alert." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_resolve_onboarding_followup", {
    p_id: input.id,
    p_dismiss: input.dismiss === true,
    p_by: input.by,
  });
  if (error) return { error: error.message };

  void logAdminAction(supabase, input.dismiss ? "dismiss_onboarding_alert" : "resolve_onboarding_alert", { followup_id: input.id });
  revalidatePath(PATH);
  if (input.schoolId && isUuid(input.schoolId)) revalidatePath(`${PATH}/${input.schoolId}`);
  return { success: true };
}

/** Proposes one of the two service emails for a school. It does not send: approval and sending stay with a person. */
export async function triggerOnboardingFollowup(input: { schoolId: string; rule: string; by: string }): Promise<ActionResult> {
  if (!isUuid(input.schoolId)) return { error: "Invalid school id." };
  if (!isUuid(input.by)) return { error: "Say who you are before requesting a follow-up." };
  if (!isManualRule(input.rule)) return { error: "Unknown follow-up." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_trigger_onboarding_followup", {
    p_school_id: input.schoolId,
    p_rule: input.rule,
    p_by: input.by,
  });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "trigger_onboarding_followup", { school_id: input.schoolId, rule: input.rule });
  revalidatePath(PATH);
  revalidatePath(`${PATH}/${input.schoolId}`);
  revalidatePath("/admin/trials/nudges");
  return { success: true };
}

export async function saveOnboardingSettings(input: {
  automationEnabled: boolean;
  automationStartAt: string;
  passwordReminderHours: number;
  passwordFlagHours: number;
  loginGuidanceHours: number;
  noSetupFlagHours: number;
  inactiveDays: number;
  by: string;
}): Promise<ActionResult> {
  if (!isUuid(input.by)) return { error: "Say who you are before changing settings." };
  if (typeof input.automationEnabled !== "boolean") return { error: "Choose whether automatic emails are on." };
  const start = new Date(input.automationStartAt);
  if (Number.isNaN(start.getTime())) return { error: "The start time is not a valid date." };

  const hours = [input.passwordReminderHours, input.passwordFlagHours, input.loginGuidanceHours, input.noSetupFlagHours].map((h) => rpcInt(h, 1, 720));
  if (hours.some((h) => h === null)) return { error: "Hour thresholds must be whole numbers from 1 to 720." };
  const days = rpcInt(input.inactiveDays, 1, 180);
  if (days === null) return { error: "The inactivity period must be a whole number of days from 1 to 180." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_set_onboarding_settings", {
    p_automation_enabled: input.automationEnabled,
    p_automation_start_at: start.toISOString(),
    p_password_reminder_hours: hours[0],
    p_password_flag_hours: hours[1],
    p_login_guidance_hours: hours[2],
    p_no_setup_flag_hours: hours[3],
    p_inactive_days: days,
    p_by: input.by,
  });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "set_onboarding_settings", { automation_enabled: input.automationEnabled });
  revalidatePath(PATH);
  return { success: true };
}

/** Approves the exact template text the person was shown. Fails if the text changed since the page loaded. */
export async function approveOnboardingTemplates(input: { expectedHash: string; by: string }): Promise<ActionResult> {
  if (!isUuid(input.by)) return { error: "Say who you are before approving the templates." };
  if (!/^[0-9a-f]{64}$/.test(input.expectedHash)) return { error: "Reload the page and review the templates again." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_approve_onboarding_templates", {
    p_expected_hash: input.expectedHash,
    p_by: input.by,
  });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "approve_onboarding_templates", {});
  revalidatePath(PATH);
  return { success: true };
}

export async function saveOnboardingMilestone(input: {
  key: string;
  enabled: boolean;
  required: boolean;
  weight: number;
  by: string;
}): Promise<ActionResult> {
  if (!isUuid(input.by)) return { error: "Say who you are before changing milestones." };
  if (!MILESTONE_KEYS.includes(input.key)) return { error: "Unknown milestone." };
  const weight = rpcInt(input.weight, 1, 10);
  if (weight === null) return { error: "Weight must be a whole number from 1 to 10." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_set_onboarding_milestone", {
    p_key: input.key,
    p_enabled: input.enabled === true,
    p_required: input.required === true,
    p_weight: weight,
    p_by: input.by,
  });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "set_onboarding_milestone", { milestone: input.key });
  revalidatePath(PATH);
  return { success: true };
}
