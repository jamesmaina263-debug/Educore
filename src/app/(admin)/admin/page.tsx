import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { KpiCard } from "@/components/admin/analytics/kpi-card";
import { AdminSchoolList, type SchoolListRow } from "@/components/admin/admin-school-list";

export default async function AdminOverviewPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  // Every school/subscription/invoice row is fetched in full and grouped in JS below, same
  // convention as /admin/billing and /admin/analytics (this platform has a small number of
  // tenant schools, so a single unaggregated fetch per table is simpler and cheap -- not a
  // pattern to reach for once school counts grow into the thousands).
  const [{ data: schools }, { data: subs }, { data: plans }, { data: paidInvoices }, { data: students }, { data: staff }] =
    await Promise.all([
      supabase.from("schools").select("id, name, slug, status, created_at").order("name"),
      supabase.from("school_subscriptions").select("school_id, plan_id, status"),
      supabase.from("subscription_plans").select("id, name"),
      supabase.from("platform_invoices").select("amount_kes").eq("status", "paid"),
      supabase.from("students").select("school_id"),
      supabase.from("school_users").select("school_id"),
    ]);

  const planNameById = new Map((plans ?? []).map((p) => [p.id, p.name]));
  const subBySchool = new Map((subs ?? []).map((s) => [s.school_id, s]));

  const studentCountBySchool = new Map<string, number>();
  for (const s of students ?? []) {
    if (!s.school_id) continue;
    studentCountBySchool.set(s.school_id, (studentCountBySchool.get(s.school_id) ?? 0) + 1);
  }

  const staffCountBySchool = new Map<string, number>();
  for (const s of staff ?? []) {
    if (!s.school_id) continue;
    staffCountBySchool.set(s.school_id, (staffCountBySchool.get(s.school_id) ?? 0) + 1);
  }

  const platformRevenue = (paidInvoices ?? []).reduce((sum, inv) => sum + Number(inv.amount_kes), 0);
  const totalSchools = schools?.length ?? 0;
  const activeSchools = (schools ?? []).filter((s) => s.status === "active").length;
  const totalStudents = students?.length ?? 0;

  const schoolRows: SchoolListRow[] = (schools ?? []).map((sc) => {
    const sub = subBySchool.get(sc.id);
    return {
      id: sc.id,
      name: sc.name,
      slug: sc.slug,
      status: sc.status as SchoolListRow["status"],
      student_count: studentCountBySchool.get(sc.id) ?? 0,
      staff_count: staffCountBySchool.get(sc.id) ?? 0,
      plan_name: sub?.plan_id ? (planNameById.get(sub.plan_id) ?? null) : null,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Overview</h1>
        <p className="text-sm text-muted-foreground">Platform-wide snapshot across every school on EduCore.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total Schools" value={totalSchools} sub={`${activeSchools} active`} />
        <KpiCard label="Platform Revenue" value={`KES ${platformRevenue.toLocaleString()}`} sub="Paid invoices, all time" />
        <KpiCard label="Total Students" value={totalStudents} />
        <KpiCard label="Active Schools" value={activeSchools} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Schools</h2>
        <AdminSchoolList schools={schoolRows} />
      </div>
    </div>
  );
}
