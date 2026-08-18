"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

export async function createInventoryItemAction(input: {
  name: string;
  description?: string;
  unit: string;
  reorder_level?: number;
  location?: string;
  category_id?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: schoolUser } = await supabase.from("school_users").select("school_id").eq("auth_user_id", user?.id ?? "").maybeSingle();
  if (!schoolUser) return { error: "No school context found" };

  const { error } = await supabase.from("inventory_items").insert({
    school_id: schoolUser.school_id,
    name: input.name,
    description: input.description || null,
    unit: input.unit || "pieces",
    quantity: 0,
    reorder_level: input.reorder_level ?? null,
    location: input.location || null,
    category_id: input.category_id || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/inventory", "layout");
  return { success: true };
}

export async function createCategoryAction(name: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: schoolUser } = await supabase.from("school_users").select("school_id").eq("auth_user_id", user?.id ?? "").maybeSingle();
  if (!schoolUser) return { error: "No school context found" };

  const { error } = await supabase.from("inventory_categories").insert({ school_id: schoolUser.school_id, name });
  if (error) return { error: error.message };
  revalidatePath("/inventory", "layout");
  return { success: true };
}

export async function recordStockMovementAction(input: {
  item_id: string;
  movement_type: "in" | "out";
  quantity: number;
  reason?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_stock_movement", {
    p_item_id: input.item_id,
    p_movement_type: input.movement_type,
    p_quantity: input.quantity,
    p_reason: input.reason || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/inventory", "layout");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Health transfers -- Main Store initiates, the Nurse accepts/rejects (see
// src/app/health/actions.ts for the other side of this). Stock only moves on accept.
// ---------------------------------------------------------------------------
export async function createTransferAction(input: { item_id: string; quantity: number }): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_inventory_transfer", {
    p_item_id: input.item_id,
    p_quantity: input.quantity,
  });
  if (error) return { error: error.message };
  revalidatePath("/inventory", "layout");
  return { success: true };
}

async function currentSchoolUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, schoolUser: null };
  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("id, school_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return { supabase, schoolUser };
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
export async function createAssetAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const assetTag = String(formData.get("asset_tag") ?? "").trim();
  const serialNumber = String(formData.get("serial_number") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const purchaseDate = String(formData.get("purchase_date") ?? "") || null;
  const purchaseValue = String(formData.get("purchase_value") ?? "") || null;
  if (!name) return { error: "Asset name is required." };

  const { error } = await supabase.from("assets").insert({
    school_id: schoolUser.school_id,
    name,
    category: category || null,
    asset_tag: assetTag || null,
    serial_number: serialNumber || null,
    location: location || null,
    purchase_date: purchaseDate,
    purchase_value: purchaseValue,
  });
  if (error) return { error: error.message };
  revalidatePath("/inventory", "layout");
  return { success: true };
}

export async function updateAssetStatusAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const assetId = String(formData.get("asset_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const condition = String(formData.get("condition") ?? "");
  if (!assetId || !status) return { error: "Missing asset or status." };

  const { error } = await supabase
    .from("assets")
    .update({ status, condition: condition || undefined, updated_at: new Date().toISOString() })
    .eq("id", assetId);
  if (error) return { error: error.message };
  revalidatePath("/inventory", "layout");
  return { success: true };
}

export async function requestAssetMaintenanceAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const assetId = String(formData.get("asset_id") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  if (!assetId || !description) return { error: "Asset and description are required." };

  const { error } = await supabase.from("asset_maintenance_records").insert({
    school_id: schoolUser.school_id,
    asset_id: assetId,
    description,
    requested_by: schoolUser.id,
  });
  if (error) return { error: error.message };

  const { error: statusError } = await supabase
    .from("assets")
    .update({ status: "under_maintenance", updated_at: new Date().toISOString() })
    .eq("id", assetId);
  if (statusError) {
    // The maintenance record itself is already saved -- that's the real record --
    // but tell the caller its status badge won't reflect it, rather than staying silent.
    return { error: `Maintenance request saved, but the asset's status could not be updated: ${statusError.message}` };
  }

  revalidatePath("/inventory", "layout");
  return { success: true };
}

export async function completeAssetMaintenanceAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const recordId = String(formData.get("record_id") ?? "");
  const assetId = String(formData.get("asset_id") ?? "");
  const cost = String(formData.get("cost") ?? "") || null;
  const notes = String(formData.get("notes") ?? "").trim();
  if (!recordId) return { error: "Missing maintenance record." };

  const { error } = await supabase
    .from("asset_maintenance_records")
    .update({ status: "completed", completed_date: new Date().toISOString().slice(0, 10), cost, notes: notes || null, updated_at: new Date().toISOString() })
    .eq("id", recordId);
  if (error) return { error: error.message };

  if (assetId) {
    const { error: statusError } = await supabase
      .from("assets")
      .update({ status: "in_use", updated_at: new Date().toISOString() })
      .eq("id", assetId);
    if (statusError) {
      return { error: `Maintenance marked complete, but the asset's status could not be updated: ${statusError.message}` };
    }
  }

  revalidatePath("/inventory", "layout");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------
export async function createSupplierAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const name = String(formData.get("name") ?? "").trim();
  const contactPerson = String(formData.get("contact_person") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  if (!name) return { error: "Supplier name is required." };

  const { error } = await supabase.from("suppliers").insert({
    school_id: schoolUser.school_id,
    name,
    contact_person: contactPerson || null,
    phone: phone || null,
    email: email || null,
    category: category || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/inventory", "layout");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Procurement: Requisition -> Purchase Order -> Goods Received -> Supplier Invoice
// ---------------------------------------------------------------------------
export async function createRequisitionAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const purpose = String(formData.get("purpose") ?? "").trim();
  const itemDescription = String(formData.get("item_description") ?? "").trim();
  const quantity = String(formData.get("quantity") ?? "");
  const estimatedCost = String(formData.get("estimated_unit_cost") ?? "") || null;
  if (!purpose || !itemDescription || !quantity) return { error: "Purpose, item, and quantity are required." };

  const { data: requisition, error } = await supabase
    .from("purchase_requisitions")
    .insert({ school_id: schoolUser.school_id, purpose, status: "submitted", requested_by: schoolUser.id })
    .select("id")
    .single();
  if (error) return { error: error.message };

  if (requisition) {
    const { error: itemError } = await supabase.from("purchase_requisition_items").insert({
      requisition_id: requisition.id,
      school_id: schoolUser.school_id,
      item_description: itemDescription,
      quantity,
      estimated_unit_cost: estimatedCost,
    });
    if (itemError) {
      // Don't leave an itemless requisition behind claiming success -- roll the header back.
      await supabase.from("purchase_requisitions").delete().eq("id", requisition.id);
      return { error: `Could not save the requisition item: ${itemError.message}` };
    }
  }

  revalidatePath("/inventory", "layout");
  return { success: true };
}

export async function decideRequisitionAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const requisitionId = String(formData.get("requisition_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!requisitionId || !["approved", "rejected"].includes(decision)) return { error: "Missing requisition or decision." };

  const { error } = await supabase
    .from("purchase_requisitions")
    .update({ status: decision, approved_by: schoolUser.id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", requisitionId);
  if (error) return { error: error.message };
  revalidatePath("/inventory", "layout");
  return { success: true };
}

export async function createPurchaseOrderAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const requisitionId = String(formData.get("requisition_id") ?? "") || null;
  const supplierId = String(formData.get("supplier_id") ?? "");
  const poNumber = String(formData.get("po_number") ?? "").trim();
  const itemDescription = String(formData.get("item_description") ?? "").trim();
  const quantity = String(formData.get("quantity") ?? "");
  const unitCost = String(formData.get("unit_cost") ?? "");
  const expectedDate = String(formData.get("expected_date") ?? "") || null;
  if (!supplierId || !poNumber || !itemDescription || !quantity || !unitCost) {
    return { error: "Supplier, PO number, item, quantity, and unit cost are required." };
  }

  const { data: po, error } = await supabase
    .from("purchase_orders")
    .insert({
      school_id: schoolUser.school_id,
      requisition_id: requisitionId,
      supplier_id: supplierId,
      po_number: poNumber,
      status: "sent",
      expected_date: expectedDate,
      created_by: schoolUser.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  if (po) {
    const { error: itemError } = await supabase.from("purchase_order_items").insert({
      po_id: po.id,
      school_id: schoolUser.school_id,
      item_description: itemDescription,
      quantity,
      unit_cost: unitCost,
    });
    if (itemError) {
      // Don't leave an itemless PO behind claiming success -- roll the header back, and
      // leave the requisition (if any) exactly as it was so it can be converted again.
      await supabase.from("purchase_orders").delete().eq("id", po.id);
      return { error: `Could not save the purchase order item: ${itemError.message}` };
    }
    if (requisitionId) {
      await supabase.from("purchase_requisitions").update({ status: "converted", updated_at: new Date().toISOString() }).eq("id", requisitionId);
    }
  }

  revalidatePath("/inventory", "layout");
  return { success: true };
}

export async function receiveGoodsAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const poId = String(formData.get("po_id") ?? "");
  const poItemId = String(formData.get("po_item_id") ?? "");
  const quantityReceived = String(formData.get("quantity_received") ?? "");
  const conditionNotes = String(formData.get("condition_notes") ?? "").trim();
  if (!poId || !poItemId || !quantityReceived) return { error: "Missing PO, item, or quantity." };

  const { data: grn, error } = await supabase
    .from("goods_received_notes")
    .insert({ school_id: schoolUser.school_id, po_id: poId, received_by: schoolUser.id })
    .select("id")
    .single();
  if (error) return { error: error.message };

  if (grn) {
    const { error: itemError } = await supabase.from("goods_received_items").insert({
      grn_id: grn.id,
      school_id: schoolUser.school_id,
      po_item_id: poItemId,
      quantity_received: quantityReceived,
      condition_notes: conditionNotes || null,
    });
    if (itemError) {
      // Don't leave an itemless GRN behind claiming success -- and critically, don't let the
      // PO's received-quantity/status silently stay stale as if nothing was ever recorded.
      await supabase.from("goods_received_notes").delete().eq("id", grn.id);
      return { error: `Could not save the received item: ${itemError.message}` };
    }

    const { error: recordError } = await supabase.rpc("record_goods_received", {
      p_po_id: poId,
      p_po_item_id: poItemId,
      p_quantity_received: Number(quantityReceived),
    });
    if (recordError) {
      // The GRN + item are already saved at this point -- that's real, so we don't
      // delete it -- but the PO's received-quantity/status update failed, so surface
      // that clearly instead of pretending everything is in sync.
      return { error: `Received item was recorded, but updating the purchase order failed: ${recordError.message}` };
    }
  }

  revalidatePath("/inventory", "layout");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Supplier Invoices — document/reference only; the payment itself is recorded
// in Finance's own expenses flow, never duplicated here.
// ---------------------------------------------------------------------------
export async function createSupplierInvoiceAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const supplierId = String(formData.get("supplier_id") ?? "");
  const poId = String(formData.get("po_id") ?? "") || null;
  const invoiceNumber = String(formData.get("invoice_number") ?? "").trim();
  const invoiceDate = String(formData.get("invoice_date") ?? "");
  const amount = String(formData.get("amount") ?? "");
  if (!supplierId || !invoiceNumber || !invoiceDate || !amount) {
    return { error: "Supplier, invoice number, date, and amount are required." };
  }

  const { error } = await supabase.from("supplier_invoices").insert({
    school_id: schoolUser.school_id,
    supplier_id: supplierId,
    po_id: poId,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    amount,
  });
  if (error) return { error: error.message };
  revalidatePath("/inventory", "layout");
  return { success: true };
}

export async function markSupplierInvoicePaidAction(formData: FormData): Promise<ActionResult> {
  const { supabase } = await currentSchoolUser();
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!invoiceId) return { error: "Missing invoice." };

  const { error } = await supabase
    .from("supplier_invoices")
    .update({ status: "paid", updated_at: new Date().toISOString() })
    .eq("id", invoiceId);
  if (error) return { error: error.message };
  revalidatePath("/inventory", "layout");
  return { success: true };
}

