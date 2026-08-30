import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminBillingTable, type SchoolBillingRow } from "@/components/admin/admin-billing-table";

export default async function AdminBillingPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const [{ data: schools }, { data: subs }, { data: plans }, { data: invoices }] = await Promise.all([
    supabase.from("schools").select("id, name, status").order("name"),
    supabase.from("school_subscriptions").select("school_id, status, plan_id, trial_ends_at, current_period_end"),
    supabase.from("subscription_plans").select("id, code, name, price_per_student_kes").order("price_per_student_kes"),
    supabase
      .from("platform_invoices")
      .select("id, school_id, period_start, period_end, amount_kes, status, due_at")
      .order("due_at", { ascending: false })
      .limit(50),
  ]);

  const subsBySchool = new Map((subs ?? []).map((s) => [s.school_id, s]));
  const rows: SchoolBillingRow[] = (schools ?? []).map((sc) => {
    const sub = subsBySchool.get(sc.id);
    return {
      school_id: sc.id,
      school_name: sc.name,
      school_status: sc.status,
      subscription_status: sub?.status ?? null,
      plan_id: sub?.plan_id ?? null,
      trial_ends_at: sub?.trial_ends_at ?? null,
      current_period_end: sub?.current_period_end ?? null,
      invoices: (invoices ?? []).filter((i) => i.school_id === sc.id),
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Platform billing</h1>
        <p className="text-sm text-muted-foreground">
          Every school&apos;s subscription and invoices — visible to platform staff only.
        </p>
      </div>
      <AdminBillingTable rows={rows} plans={plans ?? []} />
    </div>
  );
}
