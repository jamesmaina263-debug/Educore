"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createInventoryItemAction, recordStockMovementAction } from "@/app/inventory/actions";

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

  // If drawn from tracked medical inventory, deduct stock through the
  // existing Inventory stock-movement path rather than a parallel one —
  // this also gets us the audit trail in inventory_stock_movements for free.
  if (input.inventory_item_id) {
    const stockResult = await recordStockMovementAction({
      item_id: input.inventory_item_id,
      movement_type: "out",
      quantity: 1,
      reason: `Administered to student — ${input.medication_name}`,
    });
    if ("error" in stockResult) return { error: `Stock deduction failed: ${stockResult.error}` };
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

// ---------- Medical inventory (thin wrapper over the existing Inventory module) ----------

export async function addMedicalInventoryItem(input: {
  name: string;
  unit: string;
  reorder_level?: number;
  expiry_date?: string;
  medicalCategoryId: string;
}): Promise<ActionResult> {
  const result = await createInventoryItemAction({
    name: input.name,
    unit: input.unit,
    reorder_level: input.reorder_level,
    category_id: input.medicalCategoryId,
  });
  if ("error" in result) return result;

  // createInventoryItemAction doesn't take expiry_date (not all inventory
  // needs it) — set it directly here for the medical item just created.
  if (input.expiry_date) {
    const supabase = await createClient();
    const me = await currentActor(supabase);
    if (me) {
      await supabase
        .from("inventory_items")
        .update({ expiry_date: input.expiry_date })
        .eq("school_id", me.school_id)
        .eq("category_id", input.medicalCategoryId)
        .eq("name", input.name)
        .is("expiry_date", null);
    }
  }
  revalidatePath("/health");
  return { success: true };
}

export async function adjustMedicalStock(
  itemId: string,
  movementType: "in" | "out",
  quantity: number,
  reason?: string,
): Promise<ActionResult> {
  const result = await recordStockMovementAction({ item_id: itemId, movement_type: movementType, quantity, reason });
  revalidatePath("/health");
  return result;
}
