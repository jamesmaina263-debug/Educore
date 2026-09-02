"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

export async function createInventoryItemAction(input: {
  name: string;
  description?: string;
  unit: string;
  quantity?: number;
  reorder_level?: number;
  location?: string;
  category_id?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_inventory_item", {
    p_name: input.name,
    p_unit: input.unit,
    p_quantity: input.quantity ?? 0,
    p_description: input.description || null,
    p_reorder_level: input.reorder_level ?? null,
    p_location: input.location || null,
    p_category_id: input.category_id || null,
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
  // OS-08: generated once by the caller at queue time (see inventory-section.tsx) so an
  // offline-queue retry after a lost ack replays with the same key -- record_stock_movement()
  // recognizes it and returns the already-applied result instead of moving stock twice.
  client_mutation_id?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_stock_movement", {
    p_item_id: input.item_id,
    p_movement_type: input.movement_type,
    p_quantity: input.quantity,
    p_reason: input.reason || null,
    p_client_mutation_id: input.client_mutation_id || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/inventory", "layout");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Health transfers -- Main Store initiates, the Nurse accepts/rejects (see
// src/app/health/actions.ts for the other side of this). Stock only moves on accept.
// ---------------------------------------------------------------------------
export async function createTransferAction(input: { items: { item_id: string; quantity: number }[] }): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_inventory_transfers", {
    p_items: input.items.map((i) => ({ item_id: i.item_id, quantity: i.quantity })),
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
    .select("id, school_id, full_name")
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
// Storekeeper requisitions: accepts one or more catalog items in a single
// submission (mirrors requestMedicalSuppliesAction's shape/behavior below,
// which already supported this -- this form was the one left behind at
// single-item only).
export async function createRequisitionAction(input: {
  purpose: string;
  items: { item_description: string; quantity: number; estimated_unit_cost?: number; inventory_item_id: string }[];
}): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const purpose = input.purpose.trim();
  const items = input.items.filter((i) => i.inventory_item_id && i.item_description.trim() && i.quantity > 0);
  if (!purpose || items.length === 0) {
    return { error: "Purpose and at least one catalog item with a quantity are required." };
  }

  const { data: requisition, error } = await supabase
    .from("purchase_requisitions")
    .insert({ school_id: schoolUser.school_id, purpose, status: "submitted", requested_by: schoolUser.id })
    .select("id")
    .single();
  if (error) return { error: error.message };

  // inventory_item_id links each line to the stock catalog (and so to a
  // defined category), which is what lets approve_requisition auto-resolve
  // a supplier and cost for it from purchase history.
  const { error: itemError } = await supabase.from("purchase_requisition_items").insert(
    items.map((i) => ({
      requisition_id: requisition.id,
      school_id: schoolUser.school_id,
      item_description: i.item_description,
      quantity: i.quantity,
      estimated_unit_cost: i.estimated_unit_cost ?? null,
      inventory_item_id: i.inventory_item_id,
    })),
  );
  if (itemError) {
    // Don't leave an itemless requisition behind claiming success -- roll the header back.
    await supabase.from("purchase_requisitions").delete().eq("id", requisition.id);
    return { error: `Could not save the requisition items: ${itemError.message}` };
  }

  revalidatePath("/inventory", "layout");

  // Best-effort: let everyone who can approve procurement know a requisition
  // is waiting on them. Never block the requisition itself on this.
  const summary = items.map((i) => `${i.item_description} (qty ${i.quantity})`).join(", ");
  await supabase.rpc("notify_users_with_permission", {
    p_permission_key: "inventory.procurement.approve",
    p_subject: "Procurement requisition needs approval",
    p_body: `${schoolUser.full_name ?? "Someone"} requested: ${summary} — ${purpose}.`,
    p_action_url: "/inventory/procurement",
    p_category: "other",
  });

  return { success: true };
}

// Rejection only -- approving a requisition now goes through
// approveRequisitionAction below, which auto-generates the PO in the same
// step (approve_requisition RPC) instead of just flipping a status column.
export async function decideRequisitionAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const requisitionId = String(formData.get("requisition_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!requisitionId || decision !== "rejected") return { error: "Missing requisition, or not a rejection." };

  const { data: requisition } = await supabase
    .from("purchase_requisitions")
    .select("requested_by, purpose")
    .eq("id", requisitionId)
    .maybeSingle();

  const { error } = await supabase
    .from("purchase_requisitions")
    .update({ status: "rejected", approved_by: schoolUser.id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", requisitionId);
  if (error) return { error: error.message };
  revalidatePath("/inventory", "layout");

  // Best-effort: tell the requester the outcome. Never block the decision on this.
  if (requisition?.requested_by) {
    // She raised this via health.procurement.request, not inventory.write, so she
    // can't see /inventory/procurement -- send her to her own status view instead.
    // Everyone else keeps the original link, unchanged.
    const { data: isHealthRequester } = await supabase.rpc("school_user_has_permission", {
      p_school_user_id: requisition.requested_by,
      p_permission_key: "health.procurement.request",
    });
    const { data: canSeeMainStore } = await supabase.rpc("school_user_has_permission", {
      p_school_user_id: requisition.requested_by,
      p_permission_key: "inventory.read_any",
    });
    const actionUrl = isHealthRequester === true && canSeeMainStore !== true ? "/health/inventory" : "/inventory/procurement";

    await supabase.rpc("notify_school_user", {
      p_recipient_id: requisition.requested_by,
      p_subject: "Requisition rejected",
      p_body: `Your requisition for "${requisition.purpose}" was not approved.`,
      p_action_url: actionUrl,
      p_category: "other",
    });
  }

  return { success: true };
}

// Approves a requisition and auto-generates + sends the PO for exactly its
// requested items, via the approve_requisition RPC. If the RPC can't resolve
// a supplier (or cost) for an item, it raises and this surfaces that error to
// the caller -- the UI then asks for a supplier and retries with it set.
export async function approveRequisitionAction(formData: FormData): Promise<ActionResult> {
  const { supabase } = await currentSchoolUser();

  const requisitionId = String(formData.get("requisition_id") ?? "");
  const supplierId = String(formData.get("supplier_id") ?? "") || null;
  const unitCostOverride = String(formData.get("unit_cost_override") ?? "") || null;
  if (!requisitionId) return { error: "Missing requisition." };

  const { error } = await supabase.rpc("approve_requisition", {
    p_requisition_id: requisitionId,
    p_supplier_id: supplierId,
    p_unit_cost_override: unitCostOverride,
  });
  if (error) return { error: error.message };

  revalidatePath("/inventory", "layout");
  return { success: true };
}

export interface RequisitionApprovalPreviewRow {
  item_id: string;
  item_description: string;
  quantity: number;
  resolved_supplier_id: string | null;
  resolved_supplier_name: string | null;
  resolved_unit_cost: number | null;
  needs_supplier: boolean;
  needs_cost: boolean;
}

// Read-only check the UI runs before showing a plain "Approve" button, so it
// knows whether to ask for a supplier/cost up front instead of letting the
// approve action fail first.
export async function previewRequisitionApprovalAction(
  requisitionId: string,
): Promise<{ error: string } | { success: true; rows: RequisitionApprovalPreviewRow[] }> {
  const { supabase } = await currentSchoolUser();
  const { data, error } = await supabase.rpc("preview_requisition_approval", { p_requisition_id: requisitionId });
  if (error) return { error: error.message };
  return { success: true, rows: (data ?? []) as RequisitionApprovalPreviewRow[] };
}

export async function createPurchaseOrderAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const requisitionId = String(formData.get("requisition_id") ?? "") || null;
  const supplierId = String(formData.get("supplier_id") ?? "");
  const inventoryItemId = String(formData.get("inventory_item_id") ?? "") || null;
  const itemDescription = String(formData.get("item_description") ?? "").trim();
  const quantity = String(formData.get("quantity") ?? "");
  const unitCost = String(formData.get("unit_cost") ?? "");
  const expectedDate = String(formData.get("expected_date") ?? "") || null;
  if (!supplierId || !itemDescription || !quantity || !unitCost) {
    return { error: "Supplier, item, quantity, and unit cost are required." };
  }

  // po_number is not set here -- it comes from the column default (a DB
  // sequence), so every PO gets one automatically regardless of who or what
  // creates the row (this action, or the low-stock auto-reorder trigger).
  const { data: po, error } = await supabase
    .from("purchase_orders")
    .insert({
      school_id: schoolUser.school_id,
      requisition_id: requisitionId,
      supplier_id: supplierId,
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
      inventory_item_id: inventoryItemId,
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

    // Best-effort: email the supplier now that the PO (with its number and
    // line items) actually exists. Never block "the PO was issued" on this --
    // a missing supplier email address, for instance, is not a failure.
    const { error: emailError } = await supabase.rpc("queue_supplier_po_email", { p_po_id: po.id });
    if (emailError) {
      revalidatePath("/inventory", "layout");
      return { error: `Purchase order issued, but the supplier email could not be queued: ${emailError.message}` };
    }
  }

  revalidatePath("/inventory", "layout");
  return { success: true };
}

export async function updatePurchaseOrderItemAction(formData: FormData): Promise<ActionResult> {
  const { supabase } = await currentSchoolUser();

  const poItemId = String(formData.get("po_item_id") ?? "");
  const quantity = String(formData.get("quantity") ?? "");
  const unitCost = String(formData.get("unit_cost") ?? "") || null;
  if (!poItemId || !quantity) return { error: "Missing item or quantity." };

  const { error } = await supabase.rpc("update_purchase_order_item", {
    p_po_item_id: poItemId,
    p_quantity: quantity,
    p_unit_cost: unitCost,
  });
  if (error) return { error: error.message };
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

export async function decideHealthStockRequestAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const requestId = String(formData.get("request_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!requestId || !["approved", "rejected"].includes(decision)) return { error: "Missing request or decision." };

  const { data: request } = await supabase
    .from("health_stock_adjustment_requests")
    .select("requested_by, reason")
    .eq("id", requestId)
    .maybeSingle();

  const { error } =
    decision === "approved"
      ? await supabase.rpc("approve_health_stock_adjustment", { p_request_id: requestId })
      : await supabase.rpc("reject_health_stock_adjustment", { p_request_id: requestId, p_reason: null });
  if (error) return { error: error.message };
  revalidatePath("/inventory", "layout");
  revalidatePath("/health", "layout");

  // Best-effort: tell the Nurse the outcome. Never block the decision on this.
  if (request?.requested_by) {
    await supabase.rpc("notify_school_user", {
      p_recipient_id: request.requested_by,
      p_subject: decision === "approved" ? "Manual stock addition approved" : "Manual stock addition rejected",
      p_body:
        decision === "approved"
          ? `Your manual stock request ("${request.reason}") was approved and added to your stock.`
          : `Your manual stock request ("${request.reason}") was not approved.`,
      p_action_url: "/health/inventory",
      p_category: "other",
    });
  }

  return { success: true };
}
