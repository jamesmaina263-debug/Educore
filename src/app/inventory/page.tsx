import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { InventorySection, type ItemRow, type MovementRow, type CategoryOption } from "@/components/inventory/inventory-section";

export default async function InventoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canReadAny }, { data: canWrite }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "inventory.read_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "inventory.write" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  if (!canReadAny) {
    return (
      <AppShell
        breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Inventory" }]}
        userName={schoolUser?.full_name ?? user.email ?? "Account"}
        userRole={roleName}
        onSignOut={logout}
      >
        <p className="text-sm text-muted-foreground">You don&apos;t have access to Inventory.</p>
      </AppShell>
    );
  }

  const [{ data: itemRows }, { data: categoryRows }, { data: movementRows }] = await Promise.all([
    supabase.from("inventory_items").select("*, inventory_categories(name)").order("name"),
    supabase.from("inventory_categories").select("*").order("name"),
    supabase
      .from("inventory_stock_movements")
      .select("id, item_id, movement_type, quantity, reason, moved_at, inventory_items(name), school_users(full_name)")
      .order("moved_at", { ascending: false })
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

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Inventory" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Inventory</h1>
          <p className="text-sm text-muted-foreground">School assets and consumables — desks, lab equipment, textbooks not in circulation.</p>
        </div>
        <InventorySection items={items} categories={categories} movements={movements} canWrite={canWrite === true} />
      </div>
    </AppShell>
  );
}
