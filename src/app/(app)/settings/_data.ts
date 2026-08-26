import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { BrandingData } from "@/components/settings/branding-form";
import type { GeneralSettingsData } from "@/components/settings/general-panel";
import type { StaffRow, RoleOption } from "@/components/settings/staff-roles-table";
import type { BillingData } from "@/components/settings/billing-panel";
import type { ApiKeyRow } from "@/components/settings/api-keys-panel";
import type { BiometricDeviceRow } from "@/components/settings/biometric-devices-panel";
import type { PendingBiometricRow } from "@/components/settings/pending-biometric-panel";
import type { LeaveTypeRow } from "@/components/settings/leave-types-panel";
import { getMyNotificationPreferences, type PreferenceRow } from "@/app/notifications/actions";

export interface SettingsContext {
  userName: string;
  userRole?: string;
  schoolName: string;
  currentUserId: string;
  canWriteBranding: boolean;
  canManageStaff: boolean;
  canManagePermissions: boolean;
  canReadBilling: boolean;
  canManageBilling: boolean;
  canManageApiKeys: boolean;
  canManageBiometricDevices: boolean;
  canReadBiometricEvents: boolean;
  canViewBiometricProfiles: boolean;
  canReadAudit: boolean;
  canReadStaff: boolean;
  staff: StaffRow[];
  roles: RoleOption[];
  leaveTypes: LeaveTypeRow[];
  billingData: BillingData | null;
  preferenceRows: PreferenceRow[];
  apiKeyRows: ApiKeyRow[];
  biometricDeviceRows: BiometricDeviceRow[];
  pendingBiometricRows: PendingBiometricRow[];
  gateLateThresholds: { late_after_student: string | null; late_after_staff: string | null };
  groupBranding: { logo_url: string | null; primary_color: string | null } | null;
  brandingData: BrandingData;
  generalData: GeneralSettingsData;
}

export async function loadSettingsContext(): Promise<SettingsContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { data: schoolUser },
    { data: canWriteBranding },
    { data: canManageStaff },
    { data: canManagePermissions },
    { data: canReadBilling },
    { data: canManageBilling },
    { data: canManageApiKeys },
    { data: canManageBiometricDevices },
    { data: canReadBiometricEvents },
    { data: canViewBiometricProfiles },
    { data: canReadAudit },
    { data: canReadStaff },
  ] = await Promise.all([
    supabase
      .from("school_users")
      .select(
        "id, full_name, roles(display_name), schools(id, name, email, motto, logo_url, primary_color, school_group_id, kra_pin, gate_late_after_student, gate_late_after_staff)",
      )
      .eq("auth_user_id", user.id)
      .maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "settings.branding.write" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "staff.manage" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "settings.roles.manage" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "billing.read" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "billing.manage" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "api.manage" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "biometric.devices_manage" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "biometric.events_read" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "biometric.view" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "audit.read" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "staff.read" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const school = schoolUser?.schools as unknown as {
    id: string;
    name: string;
    school_group_id: string | null;
    email: string | null;
    motto: string | null;
    logo_url: string | null;
    primary_color: string | null;
    kra_pin: string | null;
    gate_late_after_student: string | null;
    gate_late_after_staff: string | null;
  } | null;

  const [{ data: staffRows }, { data: roleRows }, { data: leaveTypeRows }] = await Promise.all([
    supabase
      .from("school_users")
      .select("id, full_name, email, status, role_id, must_change_password, roles!inner(name, display_name)")
      .not("roles.name", "in", "(parent,student,super_admin)")
      .order("full_name"),
    supabase
      .from("roles")
      .select("id, name, display_name")
      .not("name", "in", "(parent,student,super_admin,group_admin)")
      .order("display_name"),
    supabase.from("leave_types").select("id, name, days_per_year, restricted_gender").order("name"),
  ]);

  const leaveTypes: LeaveTypeRow[] = leaveTypeRows ?? [];

  const staff: StaffRow[] = (staffRows ?? []).map((s) => {
    const role = s.roles as unknown as { name: string; display_name: string } | null;
    return {
      id: s.id,
      full_name: s.full_name,
      email: s.email,
      status: s.status as StaffRow["status"],
      role_id: s.role_id,
      role_name: role?.name ?? "",
      role_display_name: role?.display_name ?? "—",
      must_change_password: s.must_change_password ?? false,
    };
  });

  const roles: RoleOption[] = (roleRows ?? []).map((r) => ({ id: r.id, name: r.name, display_name: r.display_name }));

  let billingData: BillingData | null = null;
  if (canReadBilling === true) {
    const { data: sub } = await supabase
      .from("school_subscriptions")
      .select("status, trial_ends_at, current_period_end, subscription_plans(name)")
      .maybeSingle();
    const { data: invoiceRows } = await supabase
      .from("platform_invoices")
      .select("id, period_start, period_end, student_count, amount_kes, status, due_at, paid_at")
      .order("period_start", { ascending: false })
      .limit(12);
    const plan = sub?.subscription_plans as unknown as { name: string } | null;
    billingData = {
      status: sub?.status ?? null,
      plan_name: plan?.name ?? null,
      trial_ends_at: sub?.trial_ends_at ?? null,
      current_period_end: sub?.current_period_end ?? null,
      invoices: invoiceRows ?? [],
    };
  }

  const prefsResult = await getMyNotificationPreferences();
  const preferenceRows = "success" in prefsResult ? prefsResult.rows : [];

  let apiKeyRows: ApiKeyRow[] = [];
  if (canManageApiKeys === true) {
    const { data } = await supabase
      .from("api_keys")
      .select("id, name, key_prefix, scopes, status, last_used_at, expires_at, created_at")
      .is("school_group_id", null)
      .order("created_at", { ascending: false });
    apiKeyRows = (data ?? []) as ApiKeyRow[];
  }

  let biometricDeviceRows: BiometricDeviceRow[] = [];
  if (canManageBiometricDevices === true) {
    const { data } = await supabase
      .from("biometric_devices")
      .select("id, name, device_type, provider, location, api_key_prefix, status, last_seen_at, created_at")
      .order("created_at", { ascending: false });
    biometricDeviceRows = (data ?? []) as BiometricDeviceRow[];
  }

  // Task 12: students who are biometric-eligible (an active biometric_profiles row was
  // auto-created for them on enrollment, per the existing trigger) but have never actually had
  // a fingerprint/face captured on a device (no active biometric_credentials row for that
  // profile). Composed client-side from three simple reads rather than a new SQL function or
  // schema change -- person_id on biometric_profiles is polymorphic (student/staff), so there's
  // no FK to join through directly.
  let pendingBiometricRows: PendingBiometricRow[] = [];
  if (canViewBiometricProfiles === true) {
    const { data: profiles } = await supabase
      .from("biometric_profiles")
      .select("id, person_id")
      .eq("person_type", "student")
      .eq("status", "active");
    const profileList = profiles ?? [];
    if (profileList.length > 0) {
      const { data: credentials } = await supabase
        .from("biometric_credentials")
        .select("profile_id")
        .eq("status", "active")
        .in(
          "profile_id",
          profileList.map((p) => p.id),
        );
      const capturedProfileIds = new Set((credentials ?? []).map((c) => c.profile_id));
      const uncapturedStudentIds = profileList.filter((p) => !capturedProfileIds.has(p.id)).map((p) => p.person_id);
      if (uncapturedStudentIds.length > 0) {
        const { data: students } = await supabase
          .from("students")
          .select("id, admission_number, first_name, last_name, status, streams(name, classes(name))")
          .in("id", uncapturedStudentIds)
          .in("status", ["enrolled", "active"])
          .order("last_name");
        pendingBiometricRows = (students ?? []).map((s) => {
          const stream = s.streams as unknown as { name: string; classes: { name: string } | null } | null;
          return {
            id: s.id,
            admission_number: s.admission_number,
            first_name: s.first_name,
            last_name: s.last_name,
            class_name: stream?.classes?.name ?? null,
          };
        });
      }
    }
  }

  let groupBranding: { logo_url: string | null; primary_color: string | null } | null = null;
  if (school?.school_group_id) {
    const { data: groupRows } = await supabase.rpc("group_branding_public", {
      p_group_id: school.school_group_id,
    });
    const group = groupRows?.[0];
    if (group?.whitelabel_enabled) {
      groupBranding = { logo_url: group.logo_url, primary_color: group.primary_color };
    }
  }

  const brandingData: BrandingData = {
    name: school?.name ?? "",
    motto: school?.motto ?? null,
    logo_url: school?.logo_url ?? null,
    primary_color: school?.primary_color ?? null,
  };

  const { data: activeYear } = await supabase.from("academic_years").select("id, name").eq("status", "active").maybeSingle();
  const { data: yearTerms } = activeYear
    ? await supabase.from("terms").select("id, name, status, start_date, end_date").eq("academic_year_id", activeYear.id).order("term_number")
    : { data: [] };

  const generalData: GeneralSettingsData = {
    name: school?.name ?? "",
    email: school?.email ?? "",
    kra_pin: school?.kra_pin ?? "",
    academic_year_id: activeYear?.id ?? null,
    academic_year_name: activeYear?.name ?? null,
    terms: (yearTerms ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status as "active" | "closed" | "upcoming",
      start_date: t.start_date,
      end_date: t.end_date,
    })),
  };

  return {
    userName: schoolUser?.full_name ?? user.email ?? "Account",
    userRole: roleName,
    schoolName: school?.name ?? "EduCore",
    currentUserId: schoolUser?.id ?? "",
    canWriteBranding: canWriteBranding === true,
    canManageStaff: canManageStaff === true,
    canManagePermissions: canManagePermissions === true,
    canReadBilling: canReadBilling === true,
    canManageBilling: canManageBilling === true,
    canManageApiKeys: canManageApiKeys === true,
    canManageBiometricDevices: canManageBiometricDevices === true,
    canReadBiometricEvents: canReadBiometricEvents === true,
    canViewBiometricProfiles: canViewBiometricProfiles === true,
    canReadAudit: canReadAudit === true,
    canReadStaff: canReadStaff === true,
    staff,
    roles,
    leaveTypes,
    billingData,
    preferenceRows,
    apiKeyRows,
    biometricDeviceRows,
    pendingBiometricRows,
    gateLateThresholds: {
      late_after_student: school?.gate_late_after_student ?? null,
      late_after_staff: school?.gate_late_after_staff ?? null,
    },
    groupBranding,
    brandingData,
    generalData,
  };
}
