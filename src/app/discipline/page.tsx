import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import {
  DisciplineWelfareSection,
  type CaseRow,
  type IncidentRow,
  type SafeguardingRow,
  type StaffOption,
  type StudentOption,
  type WelfareRow,
} from "@/components/discipline/discipline-welfare-section";

export default async function DisciplinePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("id, full_name, roles(display_name), schools(name)")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!schoolUser) redirect("/login");

  const [
    { data: canReadAny },
    { data: canWrite },
    { data: canManageCases },
    { data: canWelfareWrite },
    { data: canWelfareReadAny },
    { data: canSafeguardingRead },
    { data: canSafeguardingWrite },
  ] = await Promise.all([
    supabase.rpc("auth_has_permission", { p_permission_key: "discipline.read_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "discipline.write" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "discipline.cases.manage" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "welfare.write" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "welfare.read_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "safeguarding.read" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "safeguarding.write" }),
  ]);

  const permissions = {
    canReadAny: canReadAny === true,
    canWrite: canWrite === true,
    canManageCases: canManageCases === true,
    canWelfareWrite: canWelfareWrite === true,
    canWelfareReadAny: canWelfareReadAny === true,
    canSafeguardingRead: canSafeguardingRead === true,
    canSafeguardingWrite: canSafeguardingWrite === true,
  };

  const [
    { data: students },
    { data: staff },
    { data: actionTypes },
    { data: incidentRows },
    { data: caseRows },
    { data: welfareRows },
    safeguardingResult,
  ] = await Promise.all([
    supabase.from("students").select("id, first_name, last_name, admission_number").order("first_name"),
    supabase.from("school_users").select("id, full_name").order("full_name"),
    supabase.from("disciplinary_action_types").select("id, name, category").eq("active", true).order("name"),
    supabase
      .from("discipline_records")
      .select(
        "id, incident_date, incident_type, category, description, action_taken, location, visible_to_guardian, case_id, students(id, first_name, last_name, admission_number)",
      )
      .order("incident_date", { ascending: false })
      .limit(100),
    supabase
      .from("discipline_cases")
      .select(
        "id, title, status, investigation_notes, follow_up_notes, resolution, opened_at, closed_at, assigned_officer, students(id, first_name, last_name, admission_number)",
      )
      .order("opened_at", { ascending: false }),
    supabase
      .from("welfare_concerns")
      .select(
        "id, concern_type, description, status, counselling_referral, referred_to, follow_up_notes, created_at, students(id, first_name, last_name, admission_number)",
      )
      .order("created_at", { ascending: false }),
    permissions.canSafeguardingRead
      ? supabase
          .from("safeguarding_reports")
          .select(
            "id, report_type, description, status, escalated_to, follow_up_notes, created_at, students(id, first_name, last_name, admission_number)",
          )
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const studentOptions: StudentOption[] = (students ?? []).map((s) => ({
    id: s.id,
    name: `${s.first_name} ${s.last_name}`,
    admission_number: s.admission_number,
  }));
  const staffOptions: StaffOption[] = (staff ?? []).map((s) => ({ id: s.id, name: s.full_name }));

  function studentLabel(row: { students: unknown }) {
    const st = row.students as { id: string; first_name: string; last_name: string; admission_number: string } | null;
    return st ? { id: st.id, name: `${st.first_name} ${st.last_name}`, admission_number: st.admission_number } : { id: "", name: "Unknown", admission_number: "—" };
  }

  const incidents: IncidentRow[] = (incidentRows ?? []).map((r) => ({
    id: r.id,
    incident_date: r.incident_date,
    incident_type: r.incident_type,
    category: r.category as IncidentRow["category"],
    description: r.description,
    action_taken: r.action_taken,
    location: r.location,
    visible_to_guardian: r.visible_to_guardian,
    case_id: r.case_id,
    student: studentLabel(r),
  }));

  const cases: CaseRow[] = (caseRows ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status as CaseRow["status"],
    investigation_notes: r.investigation_notes,
    follow_up_notes: r.follow_up_notes,
    resolution: r.resolution,
    opened_at: r.opened_at,
    closed_at: r.closed_at,
    assigned_officer: r.assigned_officer,
    student: studentLabel(r),
  }));

  const welfare: WelfareRow[] = (welfareRows ?? []).map((r) => ({
    id: r.id,
    concern_type: r.concern_type,
    description: r.description,
    status: r.status as WelfareRow["status"],
    counselling_referral: r.counselling_referral,
    referred_to: r.referred_to,
    follow_up_notes: r.follow_up_notes,
    created_at: r.created_at,
    student: studentLabel(r),
  }));

  const safeguardingRows = (safeguardingResult.data ?? []) as Array<{
    id: string;
    report_type: string;
    description: string;
    status: string;
    escalated_to: string | null;
    follow_up_notes: string | null;
    created_at: string;
    students: unknown;
  }>;
  const safeguarding: SafeguardingRow[] = safeguardingRows.map((r) => ({
    id: r.id,
    report_type: r.report_type as SafeguardingRow["report_type"],
    description: r.description,
    status: r.status as SafeguardingRow["status"],
    escalated_to: r.escalated_to,
    follow_up_notes: r.follow_up_notes,
    created_at: r.created_at,
    student: studentLabel(r),
  }));

  const roleName = (schoolUser.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser.schools as unknown as { name: string } | null)?.name;

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Discipline & Welfare" }]}
      userName={schoolUser.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Discipline &amp; Welfare</h1>
          <p className="text-sm text-muted-foreground">
            Incidents, cases, welfare concerns{permissions.canSafeguardingRead ? ", and safeguarding" : ""}.
          </p>
        </div>
        <DisciplineWelfareSection
          permissions={permissions}
          students={studentOptions}
          staff={staffOptions}
          actionTypes={actionTypes ?? []}
          incidents={incidents}
          cases={cases}
          welfare={welfare}
          safeguarding={safeguarding}
        />
      </div>
    </AppShell>
  );
}
