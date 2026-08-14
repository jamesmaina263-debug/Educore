"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

async function currentActor(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("school_users").select("id, school_id").eq("auth_user_id", user!.id).maybeSingle();
  return me;
}

// ---------- Sick bay ----------

export async function checkInStudent(input: {
  student_id: string;
  reason: string;
  symptoms?: string;
  temperature_c?: number;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const me = await currentActor(supabase);
  if (!me) return { error: "Could not resolve your account." };

  const { data: existingOpen } = await supabase
    .from("sick_bay_visits")
    .select("id")
    .eq("student_id", input.student_id)
    .is("check_out_at", null)
    .maybeSingle();
  if (existingOpen) return { error: "This student already has an open sick bay visit." };

  const { error } = await supabase.from("sick_bay_visits").insert({
    school_id: me.school_id,
    student_id: input.student_id,
    reason: input.reason,
    symptoms: input.symptoms || null,
    temperature_c: input.temperature_c ?? null,
    checked_in_by: me.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/health");
  return { success: true };
}

export async function checkOutStudent(
  visitId: string,
  outcome: "returned_to_class" | "sent_home" | "referred" | "collected_by_guardian",
  notes?: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const me = await currentActor(supabase);
  if (!me) return { error: "Could not resolve your account." };

  const { error } = await supabase
    .from("sick_bay_visits")
    .update({ check_out_at: new Date().toISOString(), check_out_by: me.id, outcome, notes: notes || null })
    .eq("id", visitId);
  if (error) return { error: error.message };
  revalidatePath("/health");
  return { success: true };
}

// ---------- Medication ----------

export async function administerMedication(input: {
  student_id: string;
  sick_bay_visit_id?: string;
  medication_name: string;
  dosage: string;
  route: string;
  inventory_item_id?: string;
  notes?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const me = await currentActor(supabase);
  if (!me) return { error: "Could not resolve your account." };

  // If drawn from tracked medical inventory, deduct from the Nurse's own stock pool (never
  // Main Store's directly -- she only ever draws from what's already been transferred to her).
  if (input.inventory_item_id) {
    const { error: stockError } = await supabase.rpc("issue_health_stock", {
      p_item_id: input.inventory_item_id,
      p_quantity: 1,
      p_reason: `Administered to student — ${input.medication_name}`,
    });
    if (stockError) return { error: `Stock deduction failed: ${stockError.message}` };
  }

  const { error } = await supabase.from("medication_administrations").insert({
    school_id: me.school_id,
    student_id: input.student_id,
    sick_bay_visit_id: input.sick_bay_visit_id || null,
    medication_name: input.medication_name,
    dosage: input.dosage,
    route: input.route,
    administered_at: new Date().toISOString(),
    administered_by: me.id,
    inventory_item_id: input.inventory_item_id || null,
    notes: input.notes || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/health");
  return { success: true };
}

// ---------- Referrals ----------

export async function createReferral(input: {
  student_id: string;
  sick_bay_visit_id?: string;
  referred_to: string;
  reason: string;
  referral_date: string;
  guardian_notified: boolean;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const me = await currentActor(supabase);
  if (!me) return { error: "Could not resolve your account." };

  const { error } = await supabase.from("health_referrals").insert({
    school_id: me.school_id,
    student_id: input.student_id,
    sick_bay_visit_id: input.sick_bay_visit_id || null,
    referred_to: input.referred_to,
    reason: input.reason,
    referral_date: input.referral_date,
    guardian_notified: input.guardian_notified,
    status: "pending",
    referred_by: me.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/health");
  return { success: true };
}

export async function updateReferralOutcome(
  referralId: string,
  status: "pending" | "completed" | "cancelled",
  outcome_notes?: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("health_referrals").update({ status, outcome_notes: outcome_notes || null }).eq("id", referralId);
  if (error) return { error: error.message };
  revalidatePath("/health");
  return { success: true };
}

// ---------- Emergencies ----------

export async function logEmergency(input: {
  student_id: string;
  sick_bay_visit_id?: string;
  description: string;
  severity: "moderate" | "severe" | "critical";
  action_taken?: string;
  hospital_name?: string;
  guardian_notified: boolean;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const me = await currentActor(supabase);
  if (!me) return { error: "Could not resolve your account." };

  const { error } = await supabase.from("health_emergencies").insert({
    school_id: me.school_id,
    student_id: input.student_id,
    sick_bay_visit_id: input.sick_bay_visit_id || null,
    incident_at: new Date().toISOString(),
    description: input.description,
    severity: input.severity,
    action_taken: input.action_taken || null,
    hospital_name: input.hospital_name || null,
    guardian_notified: input.guardian_notified,
    guardian_notified_at: input.guardian_notified ? new Date().toISOString() : null,
    reported_by: me.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/health");
  return { success: true };
}

// ---------- Medical inventory ----------
// Uses the Nurse-scoped RPCs (inventory.health.issue), not the shared Main Store path
// (inventory.write, which the Nurse no longer holds -- see the migration).

export async function addMedicalInventoryItem(input: {
  name: string;
  unit: string;
  reorder_level?: number;
  expiry_date?: string;
  medicalCategoryId: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_health_inventory_item", {
    p_name: input.name,
    p_unit: input.unit,
    p_reorder_level: input.reorder_level ?? null,
    p_expiry_date: input.expiry_date ?? null,
    p_category_id: input.medicalCategoryId,
  });
  if (error) return { error: error.message };
  revalidatePath("/health");
  return { success: true };
}

// "in" is deliberately not supported here -- the Nurse's stock can only grow via an accepted
// transfer from Main Store (acceptTransferAction below), never a direct addition.
export async function issueMedicalStock(itemId: string, quantity: number, reason?: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("issue_health_stock", {
    p_item_id: itemId,
    p_quantity: quantity,
    p_reason: reason || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/health");
  return { success: true };
}

export async function acceptTransferAction(transferId: string, quantityConfirmed: number): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_inventory_transfer", {
    p_transfer_id: transferId,
    p_quantity_confirmed: quantityConfirmed,
  });
  if (error) return { error: error.message };
  revalidatePath("/health");
  revalidatePath("/inventory");
  return { success: true };
}

export async function rejectTransferAction(transferId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_inventory_transfer", {
    p_transfer_id: transferId,
    p_reason: reason,
  });
  if (error) return { error: error.message };
  revalidatePath("/health");
  revalidatePath("/inventory");
  return { success: true };
}

// ---------- Guardian notification ----------

// Queues via a health-scoped RPC (health.write, not communication.write -- see the migration
// for why), then dispatches immediately through the same send-communication Edge Function
// Communication itself uses -- no second delivery pipeline.
export async function sendHealthAlertAction(input: {
  student_id: string;
  guardian_user_ids: string[];
  body: string;
}): Promise<{ error: string } | { success: true; sent: number }> {
  const supabase = await createClient();

  const { data: queuedCount, error: queueError } = await supabase.rpc("queue_health_alert", {
    p_student_id: input.student_id,
    p_guardian_user_ids: input.guardian_user_ids,
    p_body: input.body,
  });
  if (queueError) return { error: queueError.message };
  if (!queuedCount) return { error: "None of the selected guardians have a phone number on file." };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "Not signed in." };

  const { data, error } = await supabase.functions.invoke("send-communication", {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) return { error: error.message };

  revalidatePath("/health");
  return { success: true, sent: data.sent };
}
