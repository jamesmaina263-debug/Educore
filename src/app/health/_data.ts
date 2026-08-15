import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { HealthDashboardStats } from "@/components/health/dashboard-section";
import type { MedicalRecordListRow } from "@/components/health/medical-records-section";
import type { SickBayVisitRow } from "@/components/health/sick-bay-section";
import type { MedicationRow, MedicalInventoryOption } from "@/components/health/medication-section";
import type { ReferralRow } from "@/components/health/referrals-section";
import type { EmergencyRow } from "@/components/health/emergencies-section";
import type { MedicalItemRow, PendingTransferRow } from "@/components/health/inventory-section";
import type { HealthReportsData } from "@/components/health/reports-section";
import type { StudentOption } from "@/components/health/student-picker";

function fullName(row: { first_name: string; last_name: string } | null) {
  return row ? `${row.first_name} ${row.last_name}` : "Unknown";
}

export interface HealthContext {
  userName: string;
  userRole?: string;
  schoolName: string;
  canReadAny: boolean;
  canWrite: boolean;
  studentOptions: StudentOption[];
  medicalItems: MedicalItemRow[];
  inventoryOptions: MedicalInventoryOption[];
  medicalCategoryId: string | null;
  pendingTransfers: PendingTransferRow[];
  sickBayTableRows: SickBayVisitRow[];
  medicationTableRows: MedicationRow[];
  referralTableRows: ReferralRow[];
  emergencyTableRows: EmergencyRow[];
  medicalRecordRows: MedicalRecordListRow[];
  dashboardStats: HealthDashboardStats;
  reportsData: HealthReportsData;
}

export async function loadHealthContext(): Promise<HealthContext> {
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
  const roleName = (viewer?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (viewer?.schools as unknown as { name: string } | null)?.name ?? "EduCore";
  const userName = viewer?.full_name ?? user.email ?? "Account";

  const base = { userName, userRole: roleName, schoolName, canReadAny: canReadAny === true, canWrite };

  if (canReadAny !== true) {
    return {
      ...base,
      studentOptions: [],
      medicalItems: [],
      inventoryOptions: [],
      medicalCategoryId: null,
      pendingTransfers: [],
      sickBayTableRows: [],
      medicationTableRows: [],
      referralTableRows: [],
      emergencyTableRows: [],
      medicalRecordRows: [],
      dashboardStats: {
        visitsToday: 0,
        inSickBayNow: 0,
        emergenciesThisWeek: 0,
        pendingReferrals: 0,
        medicationsToday: 0,
        lowStockItems: 0,
        expiringSoonItems: 0,
        recentActivity: [],
      },
      reportsData: {
        totalVisitsThisTerm: 0,
        commonReasons: [],
        medicationsThisTerm: 0,
        referralsThisTerm: 0,
        emergenciesThisTerm: 0,
        sickBayUtilizationRate: 0,
      },
    };
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
    supabase.from("student_guardians").select("student_id, primary_contact, relationship, school_users(id, full_name, phone)"),
  ]);

  const studentOptions: StudentOption[] = (students ?? []).map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name}` }));

  const guardiansByStudent = new Map<string, { id: string; name: string; relationship: string; primary_contact: boolean }[]>();
  for (const g of guardianRows ?? []) {
    const su = g.school_users as unknown as { id: string; full_name: string; phone: string | null } | null;
    if (!su || !su.phone) continue;
    const list = guardiansByStudent.get(g.student_id) ?? [];
    list.push({ id: su.id, name: su.full_name, relationship: g.relationship, primary_contact: g.primary_contact });
    guardiansByStudent.set(g.student_id, list);
  }

  const { data: medicalItemRows } = medicalCategory
    ? await supabase
        .from("inventory_items")
        .select("id, name, unit, reorder_level, expiry_date, health_inventory_stock(quantity)")
        .eq("category_id", medicalCategory.id)
        .order("name")
    : { data: [] };

  const medicalItems: MedicalItemRow[] = (medicalItemRows ?? []).map((i) => {
    const stock = i.health_inventory_stock as unknown as { quantity: number }[] | { quantity: number } | null;
    const quantity = Array.isArray(stock) ? (stock[0]?.quantity ?? 0) : (stock?.quantity ?? 0);
    return { id: i.id, name: i.name, unit: i.unit, quantity, reorder_level: i.reorder_level, expiry_date: i.expiry_date };
  });
  const inventoryOptions: MedicalInventoryOption[] = medicalItems.filter((i) => i.quantity > 0).map((i) => ({ id: i.id, name: i.name, quantity: i.quantity }));

  const { data: pendingTransferRows } = medicalCategory
    ? await supabase
        .from("inventory_transfers")
        .select("id, item_id, quantity_requested, initiated_at, inventory_items(name, unit, category_id)")
        .eq("status", "pending")
        .order("initiated_at", { ascending: true })
    : { data: [] };

  const pendingTransfers: PendingTransferRow[] = (pendingTransferRows ?? [])
    .filter((t) => (t.inventory_items as unknown as { category_id: string } | null)?.category_id === medicalCategory?.id)
    .map((t) => {
      const item = t.inventory_items as unknown as { name: string; unit: string } | null;
      return { id: t.id, item_name: item?.name ?? "Unknown", unit: item?.unit ?? "", quantity_requested: t.quantity_requested, initiated_at: t.initiated_at };
    });

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

  const { data: medicalRecordFlags } = await supabase.from("medical_records").select("student_id, conditions, allergies");
  const flagByStudent = new Map((medicalRecordFlags ?? []).map((r) => [r.student_id, Boolean(r.conditions || r.allergies)]));
  const medicalRecordRows: MedicalRecordListRow[] = (students ?? []).map((s) => ({
    student_id: s.id,
    student_name: `${s.first_name} ${s.last_name}`,
    has_record: flagByStudent.has(s.id),
    has_conditions_or_allergies: flagByStudent.get(s.id) ?? false,
  }));

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

  return {
    ...base,
    studentOptions,
    medicalItems,
    inventoryOptions,
    medicalCategoryId: medicalCategory?.id ?? null,
    pendingTransfers,
    sickBayTableRows,
    medicationTableRows,
    referralTableRows,
    emergencyTableRows,
    medicalRecordRows,
    dashboardStats,
    reportsData,
  };
}
