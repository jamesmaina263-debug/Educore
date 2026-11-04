import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import {
  CanteenSection,
  type ItemRow,
  type LedgerRow,
  type SaleRow,
  type StudentRow,
  type WalletRow,
} from "@/components/canteen/canteen-section";
import { CANTEEN_FLAG, todayNairobi } from "@/lib/canteen";
import type { Summary } from "./actions";

export default async function CanteenPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  // Hidden entirely unless the school has the flag. hasFeatureFlag fails closed.
  if (!(await hasFeatureFlag(supabase, CANTEEN_FLAG))) notFound();

  const [{ data: schoolUser }, { data: canRead }, { data: canSell }, { data: canManage }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "canteen.read" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "canteen.sell" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "canteen.manage" }),
  ]);
  // Staff only. Families see their own wallet in the parent portal.
  if (canRead !== true) notFound();

  const today = todayNairobi();
  const [{ data: itemRows }, { data: walletRows }, { data: studentRows }, { data: streamRows }, { data: saleRows }, { data: lineRows }, { data: entryRows }, { data: summaryData }] =
    await Promise.all([
      supabase.from("canteen_items").select("id, name, price, stock_qty, reorder_level, active").order("name"),
      supabase.from("canteen_wallets").select("student_id, balance").limit(5000),
      supabase.from("students").select("id, first_name, last_name, admission_number, current_class_id, status").in("status", ["active", "enrolled"]).order("first_name").limit(5000),
      supabase.from("streams").select("id, name, classes(name)"),
      supabase.from("canteen_sales").select("id, student_id, tender, total, status, void_reason, created_at").order("created_at", { ascending: false }).limit(100),
      supabase.from("canteen_sale_lines").select("sale_id, item_name, qty, line_total").limit(1500),
      supabase.from("canteen_wallet_entries").select("id, student_id, kind, amount, balance_after, note, created_at").order("created_at", { ascending: false }).limit(1000),
      supabase.rpc("canteen_summary", { p_from: today, p_to: today }),
    ]);

  const streamName = new Map((streamRows ?? []).map((s) => [s.id as string, `${(s.classes as unknown as { name: string } | null)?.name ?? ""} ${s.name}`.trim()]));
  const students: StudentRow[] = (studentRows ?? []).map((s) => ({
    id: s.id as string,
    name: `${s.first_name} ${s.last_name}`,
    admission_number: (s.admission_number as string | null) ?? undefined,
    class_name: streamName.get((s.current_class_id as string | null) ?? "") ?? undefined,
  }));
  const nameById = new Map(students.map((s) => [s.id, s.name]));

  const items: ItemRow[] = (itemRows ?? []).map((i) => ({
    id: i.id as string,
    name: i.name as string,
    price: Number(i.price),
    stock: i.stock_qty as number,
    reorderLevel: i.reorder_level as number,
    active: i.active as boolean,
  }));
  const wallets: WalletRow[] = (walletRows ?? []).map((w) => ({ studentId: w.student_id as string, balance: Number(w.balance) }));
  const linesBySale = new Map<string, string[]>();
  for (const l of lineRows ?? []) {
    const list = linesBySale.get(l.sale_id as string) ?? [];
    list.push(`${l.qty} × ${l.item_name}`);
    linesBySale.set(l.sale_id as string, list);
  }
  const sales: SaleRow[] = (saleRows ?? []).map((s) => ({
    id: s.id as string,
    studentName: s.student_id ? (nameById.get(s.student_id as string) ?? "Student") : null,
    tender: s.tender as "wallet" | "cash",
    total: Number(s.total),
    status: s.status as "completed" | "voided",
    voidReason: (s.void_reason as string | null) ?? null,
    createdAt: s.created_at as string,
    lines: linesBySale.get(s.id as string) ?? [],
  }));
  const ledger: LedgerRow[] = (entryRows ?? []).map((e) => ({
    id: e.id as string,
    studentId: e.student_id as string,
    kind: e.kind as LedgerRow["kind"],
    amount: Number(e.amount),
    balanceAfter: Number(e.balance_after),
    note: (e.note as string | null) ?? null,
    createdAt: e.created_at as string,
  }));

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Inventory", href: "/inventory" }, { label: "Canteen" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <CanteenSection
        canSell={canSell === true}
        canManage={canManage === true}
        items={items}
        wallets={wallets}
        students={students}
        sales={sales}
        ledger={ledger}
        today={today}
        initialSummary={(summaryData as Summary | null) ?? null}
      />
    </AppShell>
  );
}
