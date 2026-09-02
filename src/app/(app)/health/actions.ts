"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { extractEdgeFunctionError } from "@/lib/edge-function-error";

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
  revalidatePath("/health", "layout");
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
  revalidatePath("/health", "layout");
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
  quantity?: number;
  notes?: string;
  // OS-08: generated once by the caller at queue time (see medication-section.tsx) so an
  // offline-queue retry after a lost ack (the original call actually landed, but the
  // response never reached the browser) is recognized here and short-circuited before
  // it can double-deduct stock or record a second dose that was never actually given.
  client_mutation_id?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const me = await currentActor(supabase);
  if (!me) return { error: "Could not resolve your account." };

  if (input.client_mutation_id) {
    const { data: existing } = await supabase
      .from("medication_administrations")
      .select("id")
      .eq("school_id", me.school_id)
      .eq("client_mutation_id", input.client_mutation_id)
      .maybeSingle();
    if (existing) {
      revalidatePath("/health", "layout");
      return { success: true };
    }
  }

  // If drawn from tracked medical inventory, deduct from the Nurse's own stock pool (never
  // Main Store's directly -- she only ever draws from what's already been transferred to her).
  // Quantity is the actual number of units given (e.g. 2 tablets), not a fixed 1 -- previously
  // hardcoded to 1 regardless of dosage, which silently under-deducted stock on every
  // multi-unit dose.
  const quantity = input.inventory_item_id ? (input.quantity && input.quantity > 0 ? Math.trunc(input.quantity) : 1) : null;
  if (input.inventory_item_id) {
    const { error: stockError } = await supabase.rpc("issue_health_stock", {
      p_item_id: input.inventory_item_id,
      p_quantity: quantity,
      p_reason: `Administered to student — ${input.medication_name}`,
      p_client_mutation_id: input.client_mutation_id || null,
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
    quantity_administered: quantity,
    notes: input.notes || null,
    client_mutation_id: input.client_mutation_id || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/health", "layout");
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
  revalidatePath("/health", "layout");
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
  revalidatePath("/health", "layout");
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
  revalidatePath("/health", "layout");
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
  revalidatePath("/health", "layout");
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
  revalidatePath("/health", "layout");
  return { success: true };
}

// Raises a requisition for approval -- the exact same purchase_requisitions /
// purchase_requisition_items tables, and the exact same approve -> issue PO ->
// email supplier flow Main Store uses (src/app/(app)/inventory/actions.ts),
// just reached from here and scoped to her own requests by the
// health.procurement.request RLS policy (20260824170000). She never gets
// purchase_orders/purchase_order_items access -- once approved, the resulting
// PO and supplier details stay with whoever approved it; she only sees her
// requisition's status change here. Receiving still happens at Main Store,
// and reaches her only via the existing Transfer to Health / Accept flow.
export async function requestMedicalSuppliesAction(input: {
  items: { item_description: string; quantity: number; estimated_unit_cost?: number; inventory_item_id: string }[];
  purpose: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const me = await currentActor(supabase);
  if (!me) return { error: "Could not resolve your account." };

  const items = input.items.filter((i) => i.inventory_item_id && i.item_description.trim() && i.quantity > 0);
  if (!input.purpose.trim() || items.length === 0) {
    return { error: "Purpose and at least one catalog item with a quantity are required." };
  }

  const { data: requisition, error } = await supabase
    .from("purchase_requisitions")
    .insert({ school_id: me.school_id, purpose: input.purpose, status: "submitted", requested_by: me.id })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const { error: itemError } = await supabase.from("purchase_requisition_items").insert(
    items.map((i) => ({
      requisition_id: requisition.id,
      school_id: me.school_id,
      item_description: i.item_description,
      quantity: i.quantity,
      estimated_unit_cost: i.estimated_unit_cost ?? null,
      // Links the line to the medical supplies catalog when she picked one --
      // that's what lets approve_requisition auto-resolve a supplier for it.
      inventory_item_id: i.inventory_item_id ?? null,
    })),
  );
  if (itemError) {
    // Don't leave an itemless requisition behind claiming success -- roll the header back.
    await supabase.from("purchase_requisitions").delete().eq("id", requisition.id);
    return { error: `Could not save the request items: ${itemError.message}` };
  }

  // Best-effort: let whoever can approve procurement (owner/principal/deputy)
  // know a medical supplies request is waiting. Never block the request on this.
  const summary = items.map((i) => `${i.item_description} (qty ${i.quantity})`).join(", ");
  await supabase.rpc("notify_users_with_permission", {
    p_permission_key: "inventory.procurement.approve",
    p_subject: "Medical supplies request needs approval",
    p_body: `The nurse requested: ${summary} — ${input.purpose}.`,
    p_action_url: "/inventory/procurement",
    p_category: "other",
  });

  revalidatePath("/health", "layout");
  return { success: true };
}

export async function acceptTransferAction(transferId: string, quantityConfirmed: number): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_inventory_transfer", {
    p_transfer_id: transferId,
    p_quantity_confirmed: quantityConfirmed,
  });
  if (error) return { error: error.message };
  revalidatePath("/health", "layout");
  revalidatePath("/inventory", "layout");
  return { success: true };
}

export async function rejectTransferAction(transferId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_inventory_transfer", {
    p_transfer_id: transferId,
    p_reason: reason,
  });
  if (error) return { error: error.message };
  revalidatePath("/health", "layout");
  revalidatePath("/inventory", "layout");
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
  if (error) return { error: await extractEdgeFunctionError(error, "Failed to send.") };

  revalidatePath("/health", "layout");
  return { success: true, sent: data.sent };
}
export async function requestHealthStockAdjustmentAction(input: {
  item_id: string;
  quantity: number;
  reason: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_health_stock_adjustment", {
    p_item_id: input.item_id,
    p_quantity: input.quantity,
    p_reason: input.reason,
  });
  if (error) return { error: error.message };

  // Best-effort: let whoever can approve procurement (owner/principal/deputy)
  // know a manual stock request is waiting. Never block the request on this.
  await supabase.rpc("notify_users_with_permission", {
    p_permission_key: "inventory.procurement.approve",
    p_subject: "Manual stock addition needs approval",
    p_body: `The nurse requested to add ${input.quantity} units — ${input.reason}.`,
    p_action_url: "/inventory/procurement",
    p_category: "other",
  });

  revalidatePath("/health", "layout");
  return { success: true };
}
