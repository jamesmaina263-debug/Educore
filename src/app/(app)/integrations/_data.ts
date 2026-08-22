import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface NemisPendingStudentRow {
  id: string;
  admission_number: string;
  full_name: string;
  upi_number: string | null;
  birth_certificate_number: string | null;
  missing_birth_cert: boolean;
}

export interface NemisBatchRow {
  id: string;
  batch_type: "new_admissions" | "full_roster";
  generated_at: string;
  student_count: number;
  status: "generated" | "confirmed";
  confirmed_at: string | null;
  generated_by_name: string | null;
  confirmed_by_name: string | null;
  notes: string | null;
}

export interface IntegrationsContext {
  userName: string;
  userRole?: string;
  schoolName: string;
  canManageNemis: boolean;
  nemisInstitutionCode: string | null;
  pendingStudents: NemisPendingStudentRow[];
  includedStudents: NemisPendingStudentRow[];
  batches: NemisBatchRow[];
}

export interface MpesaStudentOption {
  id: string;
  name: string;
  admission_number: string;
}

export interface MpesaRequestRow {
  id: string;
  student_name: string;
  amount: number;
  phone_number: string;
  status: "pending" | "completed" | "failed" | "cancelled";
  result_desc: string | null;
  initiated_at: string;
  resolved_at: string | null;
}

export interface MpesaContext {
  userName: string;
  userRole?: string;
  schoolName: string;
  canManageMpesa: boolean;
  canInitiatePush: boolean;
  shortcode: string | null;
  shortcodeType: "paybill" | "till" | null;
  environment: "sandbox" | "production";
  isActive: boolean;
  hasCredentials: boolean;
  students: MpesaStudentOption[];
  requests: MpesaRequestRow[];
}

export async function loadMpesaContext(): Promise<MpesaContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canManageMpesa }, { data: canInitiatePush }] = await Promise.all([
    supabase
      .from("school_users")
      .select("full_name, roles(display_name), schools(name)")
      .eq("auth_user_id", user.id)
      .maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "mpesa.manage" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "finance.write" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name ?? "EduCore";

  let shortcode: string | null = null;
  let shortcodeType: "paybill" | "till" | null = null;
  let environment: "sandbox" | "production" = "sandbox";
  let isActive = false;
  let hasCredentials = false;
  let students: MpesaStudentOption[] = [];
  let requests: MpesaRequestRow[] = [];

  if (canManageMpesa === true || canInitiatePush === true) {
    const { data: settings } = await supabase
      .from("mpesa_settings")
      .select("shortcode, shortcode_type, environment, is_active, credentials_saved")
      .maybeSingle();

    shortcode = settings?.shortcode ?? null;
    shortcodeType = (settings?.shortcode_type as "paybill" | "till" | null) ?? null;
    environment = (settings?.environment as "sandbox" | "production") ?? "sandbox";
    isActive = settings?.is_active ?? false;
    hasCredentials = settings?.credentials_saved ?? false;
  }

  if (canInitiatePush === true) {
    const { data: studentRows } = await supabase
      .from("students")
      .select("id, first_name, last_name, admission_number")
      .in("status", ["enrolled", "active"])
      .order("first_name");

    students = (studentRows ?? []).map((s) => ({
      id: s.id,
      name: `${s.first_name} ${s.last_name}`,
      admission_number: s.admission_number,
    }));

    const { data: requestRows } = await supabase
      .from("mpesa_stk_requests")
      .select("id, amount, phone_number, status, result_desc, initiated_at, resolved_at, students(first_name, last_name)")
      .order("initiated_at", { ascending: false })
      .limit(30);

    requests = (requestRows ?? []).map((r) => {
      const student = r.students as unknown as { first_name: string; last_name: string } | null;
      return {
        id: r.id,
        student_name: student ? `${student.first_name} ${student.last_name}` : "Unknown",
        amount: Number(r.amount),
        phone_number: r.phone_number,
        status: r.status,
        result_desc: r.result_desc,
        initiated_at: r.initiated_at,
        resolved_at: r.resolved_at,
      };
    });
  }

  return {
    userName: schoolUser?.full_name ?? user.email ?? "Account",
    userRole: roleName,
    schoolName,
    canManageMpesa: canManageMpesa === true,
    canInitiatePush: canInitiatePush === true,
    shortcode,
    shortcodeType,
    environment,
    isActive,
    hasCredentials,
    students,
    requests,
  };
}

export async function loadIntegrationsContext(): Promise<IntegrationsContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canManageNemis }] = await Promise.all([
    supabase
      .from("school_users")
      .select("full_name, roles(display_name), schools(name, nemis_institution_code)")
      .eq("auth_user_id", user.id)
      .maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "nemis.manage" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const school = schoolUser?.schools as unknown as { name: string; nemis_institution_code: string | null } | null;
  const schoolName = school?.name ?? "EduCore";

  let pendingStudents: NemisPendingStudentRow[] = [];
  let includedStudents: NemisPendingStudentRow[] = [];
  let batches: NemisBatchRow[] = [];

  if (canManageNemis === true) {
    const [{ data: students }, { data: batchRows }] = await Promise.all([
      supabase
        .from("students")
        .select("id, admission_number, first_name, last_name, upi_number, birth_certificate_number, nemis_sync_status")
        .in("status", ["enrolled", "active"])
        .in("nemis_sync_status", ["not_submitted", "included_in_batch"])
        .order("last_name"),
      supabase
        .from("nemis_sync_batches")
        .select(
          "id, batch_type, generated_at, student_count, status, confirmed_at, notes, generated_by:school_users!nemis_sync_batches_generated_by_fkey(full_name), confirmed_by:school_users!nemis_sync_batches_confirmed_by_fkey(full_name)",
        )
        .order("generated_at", { ascending: false })
        .limit(50),
    ]);

    const toRow = (s: {
      id: string;
      admission_number: string;
      first_name: string;
      last_name: string;
      upi_number: string | null;
      birth_certificate_number: string | null;
    }): NemisPendingStudentRow => ({
      id: s.id,
      admission_number: s.admission_number,
      full_name: `${s.first_name} ${s.last_name}`,
      upi_number: s.upi_number,
      birth_certificate_number: s.birth_certificate_number,
      missing_birth_cert: !s.birth_certificate_number,
    });

    pendingStudents = (students ?? [])
      .filter((s) => s.nemis_sync_status === "not_submitted")
      .map(toRow);
    includedStudents = (students ?? [])
      .filter((s) => s.nemis_sync_status === "included_in_batch")
      .map(toRow);

    batches = (batchRows ?? []).map((b) => ({
      id: b.id,
      batch_type: b.batch_type,
      generated_at: b.generated_at,
      student_count: b.student_count,
      status: b.status,
      confirmed_at: b.confirmed_at,
      notes: b.notes,
      generated_by_name: (b.generated_by as unknown as { full_name: string } | null)?.full_name ?? null,
      confirmed_by_name: (b.confirmed_by as unknown as { full_name: string } | null)?.full_name ?? null,
    }));
  }

  return {
    userName: schoolUser?.full_name ?? user.email ?? "Account",
    userRole: roleName,
    schoolName,
    canManageNemis: canManageNemis === true,
    nemisInstitutionCode: school?.nemis_institution_code ?? null,
    pendingStudents,
    includedStudents,
    batches,
  };
}
