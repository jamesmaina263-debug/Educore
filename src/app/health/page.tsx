import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DashboardSection, type HealthDashboardStats } from "@/components/health/dashboard-section";
import { MedicalRecordsSection, type MedicalRecordListRow } from "@/components/health/medical-records-section";
import { SickBaySection, type SickBayVisitRow } from "@/components/health/sick-bay-section";
import { MedicationSection, type MedicationRow, type MedicalInventoryOption } from "@/components/health/medication-section";
import { ReferralsSection, type ReferralRow } from "@/components/health/referrals-section";
import { EmergenciesSection, type EmergencyRow } from "@/components/health/emergencies-section";
import { InventorySection, type MedicalItemRow } from "@/components/health/inventory-section";
import { ReportsSection, type HealthReportsData } from "@/components/health/reports-section";
import type { StudentOption, GuardianOption } from "@/components/health/student-picker";

function fullName(row: { first_name: string; last_name: string } | null) {
  return row ? `${row.first_name} ${row.last_name}` : "Unknown";
}

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: viewer }, { data: canReadAny }, { data: canWriteData }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "health.read_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "health.write" }),
  ]);
  const canWrite = canWriteData === true;

  if (canReadAny !== true) {
    // Not the nurse or school leadership — Health is not for them (Brief 4.2:
    // "strict role-based access required"). Distinct from a 404: the module
    // exists, they just can't see it.
    return (
      <AppShell
        breadcrumbs={[{ label: "EduCore", href: "/dashboard" }, { label: "Health" }]}
        userName={viewer?.full_name ?? user.email ?? "Account"}
        onSignOut={logout}
      >
        <div className="panel p-10 text-center text-sm text-muted-foreground">
          You don&apos;t have access to the Health module.
        </div>
      </AppShell>
    );
  }

  const [
    { data: students },
    { data: sickBayRows },
    { data: medicationRows },
    { data: referralRows },
    { data: emergencyRows },
    { data: medicalCategory },
    { data: guardianRows },
  ] = await Promise.all([
    supabase.from("students").select("id, first_name, last_name").eq("status", "active").order("first_name"),
    supabase
      .from("sick_bay_visits")
      .select("id, student_id, check_in_at, reason, symptoms, temperature_c, check_out_at, outcome, students(first_name, last_name)")
      .order("check_in_at", { ascending: false }),
    supabase
      .from("medication_administrations")
      .select("id, medication_name, dosage, route, administered_at, students(first_name, last_name), administrator:administered_by(full_name)")
      .order("administered_at", { ascending: false }),
    supabase
      .from("health_referrals")
      .select("id, referred_to, reason, referral_date, status, guardian_notified, outcome_notes, students(first_name, last_name)")
      .order("referral_date", { ascending: false }),
    supabase
      .from("health_emergencies")
      .select("id, incident_at, description, severity, action_taken, hospital_name, guardian_notified, students(first_name, last_name)")
      .order("incident_at", { ascending: false }),
    supabase.from("inventory_categories").select("id").eq("name", "Medical Supplies").maybeSingle(),
    supabase
      .from("student_guardians")
      .select("student_id, primary_contact, relationship, school_users(id, full_name, phone)"),
  ]);

  const studentOptions: StudentOption[] = (students ?? []).map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name}` }));

  const guardiansByStudent = new Map<string, GuardianOption[]>();
  for (const g of guardianRows ?? []) {
    const su = g.school_users as unknown as { id: string; full_name: string; phone: string | null } | null;
    if (!su || !su.phone) continue; // no phone on file — nothing to notify, leave out of the picker entirely
    const list = guardiansByStudent.get(g.student_id) ?? [];
    list.push({ id: su.id, name: su.full_name, relationship: g.relationship, primary_contact: g.primary_contact });
    guardiansByStudent.set(g.student_id, list);
  }

  const { data: medicalItemRows } = medicalCategory
    ? await supabase
        .from("inventory_items")
        .select("id, name, unit, quantity, reorder_level, expiry_date")
        .eq("category_id", medicalCategory.id)
        .order("name")
    : { data: [] };

  const medicalItems: MedicalItemRow[] = medicalItemRows ?? [];
  const inventoryOptions: MedicalInventoryOption[] = medicalItems.filter((i) => i.quantity > 0).map((i) => ({ id: i.id, name: i.name, quantity: i.quantity }));

  const sickBayTableRows: SickBayVisitRow[] = (sickBayRows ?? []).map((v) => ({
    id: v.id,
    student_id: v.student_id,
    student_name: fullName(v.students as unknown as { first_name: string; last_name: string }),
    check_in_at: v.check_in_at,
    reason: v.reason,
    symptoms: v.symptoms,
    temperature_c: v.temperature_c,
    check_out_at: v.check_out_at,
    outcome: v.outcome,
    is_open: v.check_out_at === null,
    guardians: guardiansByStudent.get(v.student_id) ?? [],
  }));

  const medicationTableRows: MedicationRow[] = (medicationRows ?? []).map((m) => ({
    id: m.id,
    student_name: fullName(m.students as unknown as { first_name: string; last_name: string }),
    medication_name: m.medication_name,
    dosage: m.dosage,
    route: m.route,
    administered_at: m.administered_at,
    administered_by_name: (m.administrator as unknown as { full_name: string } | null)?.full_name ?? null,
  }));

  const referralTableRows: ReferralRow[] = (referralRows ?? []).map((r) => ({
    id: r.id,
    student_name: fullName(r.students as unknown as { first_name: string; last_name: string }),
    referred_to: r.referred_to,
    reason: r.reason,
    referral_date: r.referral_date,
    status: r.status as ReferralRow["status"],
    guardian_notified: r.guardian_notified,
    outcome_notes: r.outcome_notes,
  }));

  const emergencyTableRows: EmergencyRow[] = (emergencyRows ?? []).map((e) => ({
    id: e.id,
    student_name: fullName(e.students as unknown as { first_name: string; last_name: string }),
    incident_at: e.incident_at,
    description: e.description,
    severity: e.severity as EmergencyRow["severity"],
    action_taken: e.action_taken,
    hospital_name: e.hospital_name,
    guardian_notified: e.guardian_notified,
  }));

  // Medical records list — for the flag-only overview; full content stays
  // gated behind the Student profile's own Medical tab (students.medical.read).
  const { data: medicalRecordFlags } = await supabase.from("medical_records").select("student_id, conditions, allergies");
  const flagByStudent = new Map((medicalRecordFlags ?? []).map((r) => [r.student_id, Boolean(r.conditions || r.allergies)]));
  const medicalRecordRows: MedicalRecordListRow[] = (students ?? []).map((s) => ({
    student_id: s.id,
    student_name: `${s.first_name} ${s.last_name}`,
    has_record: flagByStudent.has(s.id),
    has_conditions_or_allergies: flagByStudent.get(s.id) ?? false,
  }));

  // Dashboard + Reports aggregation
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const todayTs = new Date(today).getTime();

  const reasonCounts = new Map<string, number>();
  for (const v of sickBayTableRows) {
    reasonCounts.set(v.reason, (reasonCounts.get(v.reason) ?? 0) + 1);
  }
  const commonReasons = Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const dashboardStats: HealthDashboardStats = {
    visitsToday: sickBayTableRows.filter((v) => v.check_in_at.slice(0, 10) === today).length,
    inSickBayNow: sickBayTableRows.filter((v) => v.is_open).length,
    emergenciesThisWeek: emergencyTableRows.filter((e) => e.incident_at >= sevenDaysAgo).length,
    pendingReferrals: referralTableRows.filter((r) => r.status === "pending").length,
    medicationsToday: medicationTableRows.filter((m) => m.administered_at.slice(0, 10) === today).length,
    lowStockItems: medicalItems.filter((i) => i.reorder_level !== null && i.quantity <= i.reorder_level).length,
    expiringSoonItems: medicalItems.filter((i) => i.expiry_date && new Date(i.expiry_date).getTime() - todayTs < 30 * 24 * 60 * 60 * 1000).length,
    recentActivity: [
      ...sickBayTableRows.slice(0, 3).map((v) => ({ label: `${v.student_name} checked in — ${v.reason}`, time: new Date(v.check_in_at).toLocaleString() })),
      ...emergencyTableRows.slice(0, 2).map((e) => ({ label: `Emergency: ${e.student_name}`, time: new Date(e.incident_at).toLocaleString() })),
    ]
      .sort((a, b) => (a.time < b.time ? 1 : -1))
      .slice(0, 5),
  };

  const reportsData: HealthReportsData = {
    totalVisitsThisTerm: sickBayTableRows.length,
    commonReasons,
    medicationsThisTerm: medicationTableRows.length,
    referralsThisTerm: referralTableRows.length,
    emergenciesThisTerm: emergencyTableRows.length,
    sickBayUtilizationRate: 0,
  };

  const roleName = (viewer?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (viewer?.schools as unknown as { name: string } | null)?.name;

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Health" }]}
      userName={viewer?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Health</h1>
          <p className="text-sm text-muted-foreground">Clinic, sick bay, medication, and medical records.</p>
        </div>

        <Tabs defaultValue={tab ?? "dashboard"}>
          <TabsList>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="records">Medical Records</TabsTrigger>
            <TabsTrigger value="sickbay">Sick Bay</TabsTrigger>
            <TabsTrigger value="medication">Medication</TabsTrigger>
            <TabsTrigger value="referrals">Referrals</TabsTrigger>
            <TabsTrigger value="emergencies">Emergencies</TabsTrigger>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard">
            <DashboardSection stats={dashboardStats} />
          </TabsContent>
          <TabsContent value="records">
            <MedicalRecordsSection rows={medicalRecordRows} />
          </TabsContent>
          <TabsContent value="sickbay">
            <SickBaySection visits={sickBayTableRows} studentOptions={studentOptions} canWrite={canWrite} />
          </TabsContent>
          <TabsContent value="medication">
            <MedicationSection
              administrations={medicationTableRows}
              studentOptions={studentOptions}
              inventoryOptions={inventoryOptions}
              canWrite={canWrite}
            />
          </TabsContent>
          <TabsContent value="referrals">
            <ReferralsSection referrals={referralTableRows} studentOptions={studentOptions} canWrite={canWrite} />
          </TabsContent>
          <TabsContent value="emergencies">
            <EmergenciesSection emergencies={emergencyTableRows} studentOptions={studentOptions} canWrite={canWrite} />
          </TabsContent>
          <TabsContent value="inventory">
            <InventorySection items={medicalItems} medicalCategoryId={medicalCategory?.id ?? null} canWrite={canWrite} />
          </TabsContent>
          <TabsContent value="reports">
            <ReportsSection data={reportsData} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
