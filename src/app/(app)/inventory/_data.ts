import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ItemRow, MovementRow, CategoryOption, TransferRow } from "@/components/inventory/inventory-section";
import type {
  AssetRow,
  MaintenanceRow,
  SupplierRow,
  RequisitionRow,
  PurchaseOrderRow,
  SupplierInvoiceRow,
} from "@/components/inventory/procurement-section";

export interface InventoryContext {
  userName: string;
  userRole?: string;
  schoolName: string;
  canReadAny: boolean;
  canWrite: boolean;
  canApprove: boolean;
  items: ItemRow[];
  categories: CategoryOption[];
  movements: MovementRow[];
  transfers: TransferRow[];
  assets: AssetRow[];
  maintenance: MaintenanceRow[];
  suppliers: SupplierRow[];
  requisitions: RequisitionRow[];
  purchaseOrders: PurchaseOrderRow[];
  invoices: SupplierInvoiceRow[];
}

export async function loadInventoryContext(): Promise<InventoryContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canReadAny }, { data: canWrite }, { data: canApprove }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "inventory.read_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "inventory.write" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "inventory.procurement.approve" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name ?? "EduCore";
  const userName = schoolUser?.full_name ?? user.email ?? "Account";

  const base = { userName, userRole: roleName, schoolName, canReadAny: canReadAny === true, canWrite: canWrite === true, canApprove: canApprove === true };

  if (!canReadAny) {
    return {
      ...base,
      items: [],
      categories: [],
      movements: [],
      transfers: [],
      assets: [],
      maintenance: [],
      suppliers: [],
      requisitions: [],
      purchaseOrders: [],
      invoices: [],
    };
  }

  const [
    { data: itemRows },
    { data: categoryRows },
    { data: movementRows },
    { data: assetRows },
    { data: maintenanceRows },
    { data: supplierRows },
    { data: requisitionRows },
    { data: poRows },
    { data: invoiceRows },
    { data: transferRows },
  ] = await Promise.all([
    supabase.from("inventory_items").select("*, inventory_categories(name)").order("name"),
    supabase.from("inventory_categories").select("*").order("name"),
    supabase
      .from("inventory_stock_movements")
      .select("id, item_id, movement_type, quantity, reason, moved_at, inventory_items(name), school_users(full_name)")
      .order("moved_at", { ascending: false })
      .limit(50),
    supabase.from("assets").select("*").order("name"),
    supabase
      .from("asset_maintenance_records")
      .select("id, asset_id, description, status, request_date, assets(name)")
      .order("request_date", { ascending: false }),
    supabase.from("suppliers").select("*").order("name"),
    supabase
      .from("purchase_requisitions")
      .select("id, purpose, status, created_at, purchase_requisition_items(item_description, quantity)")
      .order("created_at", { ascending: false }),
    supabase
      .from("purchase_orders")
      .select("id, po_number, status, order_date, suppliers(name), purchase_order_items(id, item_description, quantity, quantity_received)")
      .order("order_date", { ascending: false }),
    supabase.from("supplier_invoices").select("id, invoice_number, invoice_date, amount, status, suppliers(name)").order("invoice_date", { ascending: false }),
    supabase
      .from("inventory_transfers")
      .select("id, item_id, quantity_requested, quantity_confirmed, status, initiated_at, accepted_at, rejected_at, rejection_reason, inventory_items(name, unit)")
      .order("initiated_at", { ascending: false })
      .limit(50),
  ]);

  const items: ItemRow[] = (itemRows ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    category_name: (i.inventory_categories as unknown as { name: string } | null)?.name ?? null,
    unit: i.unit,
    quantity: i.quantity,
    reorder_level: i.reorder_level,
    location: i.location,
  }));

  const categories: CategoryOption[] = (categoryRows ?? []).map((c) => ({ id: c.id, name: c.name }));

  const movements: MovementRow[] = (movementRows ?? []).map((m) => ({
    id: m.id,
    item_name: (m.inventory_items as unknown as { name: string } | null)?.name ?? "Unknown",
    movement_type: m.movement_type as "in" | "out",
    quantity: m.quantity,
    reason: m.reason,
    moved_at: m.moved_at,
    actor_name: (m.school_users as unknown as { full_name: string } | null)?.full_name ?? null,
  }));

  const assets: AssetRow[] = (assetRows ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    asset_tag: a.asset_tag,
    location: a.location,
    condition: a.condition,
    status: a.status,
    purchase_value: a.purchase_value,
  }));

  const maintenance: MaintenanceRow[] = (maintenanceRows ?? []).map((m) => ({
    id: m.id,
    asset_id: m.asset_id,
    asset_name: (m.assets as unknown as { name: string } | null)?.name ?? "Unknown",
    description: m.description,
    status: m.status,
    request_date: m.request_date,
  }));

  const suppliers: SupplierRow[] = (supplierRows ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    contact_person: s.contact_person,
    phone: s.phone,
    email: s.email,
    category: s.category,
  }));

  const requisitions: RequisitionRow[] = (requisitionRows ?? []).map((r) => ({
    id: r.id,
    purpose: r.purpose,
    status: r.status,
    created_at: r.created_at,
    items: (r.purchase_requisition_items as unknown as { item_description: string; quantity: number }[]) ?? [],
  }));

  const purchaseOrders: PurchaseOrderRow[] = (poRows ?? []).map((po) => ({
    id: po.id,
    po_number: po.po_number,
    status: po.status,
    supplier_name: (po.suppliers as unknown as { name: string } | null)?.name ?? "Unknown",
    order_date: po.order_date,
    items: (po.purchase_order_items as unknown as PurchaseOrderRow["items"]) ?? [],
  }));

  const invoices: SupplierInvoiceRow[] = (invoiceRows ?? []).map((inv) => ({
    id: inv.id,
    invoice_number: inv.invoice_number,
    invoice_date: inv.invoice_date,
    amount: inv.amount,
    status: inv.status,
    supplier_name: (inv.suppliers as unknown as { name: string } | null)?.name ?? "Unknown",
  }));

  const transfers: TransferRow[] = (transferRows ?? []).map((t) => {
    const item = t.inventory_items as unknown as { name: string; unit: string } | null;
    return {
      id: t.id,
      item_name: item?.name ?? "Unknown",
      unit: item?.unit ?? "",
      quantity_requested: t.quantity_requested,
      quantity_confirmed: t.quantity_confirmed,
      status: t.status as "pending" | "accepted" | "rejected",
      initiated_at: t.initiated_at,
      accepted_at: t.accepted_at,
      rejected_at: t.rejected_at,
      rejection_reason: t.rejection_reason,
    };
  });

  return { ...base, items, categories, movements, transfers, assets, maintenance, suppliers, requisitions, purchaseOrders, invoices };
}
