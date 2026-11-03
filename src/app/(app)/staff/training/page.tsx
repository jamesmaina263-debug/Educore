import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { StaffTrainingSection, type StaffOption } from "@/components/staff/staff-training-section";
import {
  TRAINING_FLAG,
  parseWindow,
  type OverviewKind,
  type OverviewRow,
  type TrainingCategory,
  type TrainingRecord,
  type TrainingStatus,
} from "@/lib/staff/training";

export default async function StaffTrainingPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: daysParam } = await searchParams;
  const windowDays = parseWindow(daysParam);

  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  // Hidden entirely unless the school has the flag. hasFeatureFlag fails closed (any error => false).
  if (!(await hasFeatureFlag(supabase, TRAINING_FLAG))) notFound();

  const [{ data: schoolUser }, { data: canRead }, { data: canManage }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "staff.read" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "staff.manage" }),
  ]);
  if (canRead !== true && canManage !== true) notFound();

  const [{ data: overviewRows }, { data: recordRows }, { data: staffRows }] = await Promise.all([
    supabase.rpc("staff_expiry_overview", { p_within_days: windowDays }),
    supabase
      .from("staff_training_records")
      .select("id, staff_id, title, provider, category, status, start_date, end_date, hours, expires_on, notes, school_users!staff_training_records_staff_id_fkey(full_name)")
      .order("start_date", { ascending: false })
      .limit(500),
    supabase
      .from("school_users")
      .select("id, full_name, roles!inner(name)")
      .eq("status", "active")
      .not("roles.name", "in", "(parent,student,super_admin)")
      .order("full_name", { ascending: true })
      .limit(1000),
  ]);

  const overview: OverviewRow[] = ((overviewRows ?? []) as {
    kind: string;
    staff_id: string;
    staff_name: string;
    label: string;
    due_date: string;
    days_left: number;
  }[]).map((r) => ({
    kind: r.kind as OverviewKind,
    staffId: r.staff_id,
    staffName: r.staff_name,
    label: r.label,
    dueDate: r.due_date,
    daysLeft: r.days_left,
  }));

  const records: TrainingRecord[] = (recordRows ?? []).map((r) => {
    const su = r.school_users as unknown as { full_name: string } | { full_name: string }[] | null;
    const name = Array.isArray(su) ? su[0]?.full_name : su?.full_name;
    return {
      id: r.id as string,
      staffId: r.staff_id as string,
      staffName: name ?? "Staff member",
      title: r.title as string,
      provider: (r.provider as string | null) ?? null,
      category: r.category as TrainingCategory,
      status: r.status as TrainingStatus,
      startDate: r.start_date as string,
      endDate: (r.end_date as string | null) ?? null,
      hours: r.hours === null || r.hours === undefined ? null : Number(r.hours),
      expiresOn: (r.expires_on as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
    };
  });

  const staff: StaffOption[] = (staffRows ?? []).map((s) => ({ id: s.id as string, name: s.full_name as string }));

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Staff", href: "/staff" }, { label: "Training and expiry" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Staff training and expiry</h1>
          <p className="text-sm text-muted-foreground">
            What is expiring soon across contracts, qualifications and training, plus training records. This page only records; it renews nothing and
            sends nothing.
          </p>
        </div>
        <StaffTrainingSection overview={overview} records={records} staff={staff} canManage={canManage === true} windowDays={windowDays} />
      </div>
    </AppShell>
  );
}
