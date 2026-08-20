import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DocumentsTab, type DocumentRow } from "@/components/documents-tab";
import { EmploymentTab, type EmploymentData } from "./employment-tab";
import { QualificationsTab, type QualificationRow } from "./qualifications-tab";
import { LeaveTab, type LeaveTypeOption, type LeaveRequestRow } from "./leave-tab";

export default async function StaffProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: viewer } = await supabase
    .from("school_users")
    .select("id, full_name, roles(display_name), schools(name)")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const { data: staff } = await supabase
    .from("school_users")
    .select(
      "id, full_name, email, phone, status, position, department, hire_date, contract_type, contract_end_date, gender, roles(display_name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!staff) notFound();

  const isSelf = viewer?.id === staff.id;

  const [
    { data: canManage },
    { data: canApproveLeave },
    { data: qualificationRows },
    { data: leaveTypeRows },
    { data: leaveRequestRows },
    { data: documentRows },
  ] = await Promise.all([
    supabase.rpc("auth_has_permission", { p_permission_key: "staff.manage" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "staff.leave.approve" }),
    supabase
      .from("staff_qualifications")
      .select("id, qualification_name, institution, year_obtained, expiry_date")
      .eq("staff_id", id)
      .order("year_obtained", { ascending: false }),
    supabase.from("leave_types").select("id, name, days_per_year, restricted_gender").order("name"),
    supabase
      .from("leave_requests")
      .select("id, start_date, end_date, days_count, status, reason, leave_types(name, id)")
      .eq("staff_id", id)
      .order("start_date", { ascending: false }),
    supabase
      .from("documents")
      .select("id, category, file_name, storage_path, created_at")
      .eq("staff_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const qualifications: QualificationRow[] = qualificationRows ?? [];
  const leaveTypes: LeaveTypeOption[] = leaveTypeRows ?? [];
  const documents: DocumentRow[] = documentRows ?? [];

  const currentYear = new Date().getFullYear();
  const requests: LeaveRequestRow[] = (leaveRequestRows ?? []).map((r) => ({
    id: r.id,
    leave_type_name: (r.leave_types as unknown as { name: string } | null)?.name ?? "—",
    start_date: r.start_date,
    end_date: r.end_date,
    days_count: Number(r.days_count),
    status: r.status as LeaveRequestRow["status"],
    reason: r.reason,
  }));

  const balances = leaveTypes.map((t) => {
    const used = (leaveRequestRows ?? [])
      .filter(
        (r) =>
          (r.leave_types as unknown as { id: string } | null)?.id === t.id &&
          r.status === "approved" &&
          new Date(r.start_date).getFullYear() === currentYear,
      )
      .reduce((sum, r) => sum + Number(r.days_count), 0);
    return { leave_type_id: t.id, name: t.name, allocated: t.days_per_year, used };
  });

  const canManageStaff = canManage === true;
  const canReadDocuments = canManageStaff || isSelf;

  const viewerRoleName = (viewer?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (viewer?.schools as unknown as { name: string } | null)?.name;
  const staffRoleName = (staff.roles as unknown as { display_name: string } | null)?.display_name;

  const employmentData: EmploymentData = {
    position: staff.position,
    department: staff.department,
    hire_date: staff.hire_date,
    contract_type: staff.contract_type as EmploymentData["contract_type"],
    contract_end_date: staff.contract_end_date,
    gender: staff.gender as EmploymentData["gender"],
  };

  return (
    <AppShell
      breadcrumbs={[
        { label: schoolName ?? "EduCore", href: "/dashboard" },
        { label: "Staff", href: "/staff" },
        { label: staff.full_name },
      ]}
      userName={viewer?.full_name ?? user.email ?? "Account"}
      userRole={viewerRoleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <Avatar className="size-12">
            <AvatarFallback>
              {staff.full_name
                .split(" ")
                .map((p: string) => p[0])
                .slice(0, 2)
                .join("")}
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-lg font-semibold">{staff.full_name}</h1>
            <p className="text-sm text-muted-foreground">
              {staffRoleName}
              {staff.email ? ` · ${staff.email}` : ""}
              {staff.phone ? ` · ${staff.phone}` : ""}
            </p>
          </div>
          <StatusBadge tone={staff.status === "active" ? "success" : "neutral"} label={staff.status} className="ml-auto" />
        </div>

        <Tabs defaultValue="employment">
          <TabsList>
            <TabsTrigger value="employment">Employment</TabsTrigger>
            <TabsTrigger value="qualifications">Qualifications</TabsTrigger>
            <TabsTrigger value="leave">Leave</TabsTrigger>
            {canReadDocuments && <TabsTrigger value="documents">Documents</TabsTrigger>}
          </TabsList>

          <TabsContent value="employment">
            <EmploymentTab staffId={id} data={employmentData} canManage={canManageStaff} />
          </TabsContent>

          <TabsContent value="qualifications">
            <QualificationsTab staffId={id} qualifications={qualifications} canManage={canManageStaff} />
          </TabsContent>

          <TabsContent value="leave">
            <LeaveTab
              staffId={id}
              leaveTypes={leaveTypes}
              requests={requests}
              balances={balances}
              isSelf={isSelf}
              canApprove={canApproveLeave === true}
              staffGender={staff.gender as "male" | "female" | null}
            />
          </TabsContent>

          {canReadDocuments && (
            <TabsContent value="documents">
              <DocumentsTab ownerId={id} ownerType="staff" documents={documents} canUpload={canManageStaff} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </AppShell>
  );
}
