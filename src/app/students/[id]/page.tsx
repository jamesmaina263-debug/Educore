import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GuardiansTab, type GuardianRow } from "./guardians-tab";
import { DocumentsTab, type DocumentRow } from "./documents-tab";
import { MedicalTab } from "./medical-tab";
import { CertificatesTab, type CertificateRow } from "./certificates-tab";
import { DisciplineTab, type DisciplineRow } from "./discipline-tab";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default async function StudentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("full_name, roles(display_name), schools(name)")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const { data: student } = await supabase
    .from("students")
    .select(
      "id, admission_number, upi_number, first_name, last_name, other_names, date_of_birth, gender, status, admission_date, streams(name, classes(name))",
    )
    .eq("id", id)
    .maybeSingle();

  if (!student) notFound();

  const { data: guardianLinks } = await supabase
    .from("student_guardians")
    .select("id, relationship, primary_contact, school_users(full_name, phone)")
    .eq("student_id", id);

  const guardians: GuardianRow[] = (guardianLinks ?? []).map((g) => ({
    id: g.id,
    full_name: (g.school_users as unknown as { full_name: string } | null)?.full_name ?? "—",
    phone: (g.school_users as unknown as { phone: string | null } | null)?.phone ?? null,
    relationship: g.relationship,
    primary_contact: g.primary_contact,
  }));

  const { data: documentRows } = await supabase
    .from("documents")
    .select("id, category, file_name, storage_path, created_at")
    .eq("student_id", id)
    .order("created_at", { ascending: false });

  const documents: DocumentRow[] = documentRows ?? [];

  const { data: certificateRows } = await supabase
    .from("certificates")
    .select("id, certificate_type, title, description, issued_date")
    .eq("student_id", id)
    .order("issued_date", { ascending: false });
  const certificates: CertificateRow[] = certificateRows ?? [];

  const { data: disciplineRows } = await supabase
    .from("discipline_records")
    .select("id, incident_date, category, description, action_taken, visible_to_guardian")
    .eq("student_id", id)
    .order("incident_date", { ascending: false });
  const disciplineRecords: DisciplineRow[] = disciplineRows ?? [];

  const canManageStudents = (await supabase.rpc("auth_has_permission", { p_permission_key: "students.write" })).data === true;
  const canUploadDocuments = (await supabase.rpc("auth_has_permission", { p_permission_key: "students.documents.write" })).data === true;
  const canIssueCertificates = (await supabase.rpc("auth_has_permission", { p_permission_key: "certificates.write" })).data === true;
  const canWriteDiscipline = (await supabase.rpc("auth_has_permission", { p_permission_key: "discipline.write" })).data === true;

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;
  const fullName = [student.first_name, student.other_names, student.last_name].filter(Boolean).join(" ");
  const stream = student.streams as unknown as { name: string; classes: { name: string } | null } | null;
  const classLabel = stream ? `${stream.classes?.name ?? ""} ${stream.name}`.trim() : "Unassigned";

  return (
    <AppShell
      breadcrumbs={[
        { label: schoolName ?? "EduCore", href: "/dashboard" },
        { label: "Students", href: "/students" },
        { label: fullName },
      ]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <Avatar className="size-12">
            <AvatarFallback>
              {student.first_name[0]}
              {student.last_name[0]}
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-lg font-semibold">{fullName}</h1>
            <p className="text-sm text-muted-foreground">
              {student.admission_number}
              {student.upi_number ? ` · UPI ${student.upi_number}` : ""}
            </p>
          </div>
          <StatusBadge
            tone={student.status === "active" || student.status === "enrolled" ? "success" : "neutral"}
            label={student.status}
            className="ml-auto"
          />
          <Button asChild variant="outline" size="sm">
            <Link href={`/students/${id}/id-card`} target="_blank">
              Print ID card
            </Link>
          </Button>
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="guardians">Guardians</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="medical">Medical</TabsTrigger>
            <TabsTrigger value="certificates">Certificates</TabsTrigger>
            <TabsTrigger value="discipline">Discipline</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Date of birth</dt>
                <dd>{student.date_of_birth}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Gender</dt>
                <dd className="capitalize">{student.gender}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Admission date</dt>
                <dd>{student.admission_date}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Class / Stream</dt>
                <dd className={stream ? undefined : "text-muted-foreground"}>{classLabel}</dd>
              </div>
            </dl>
          </TabsContent>

          <TabsContent value="guardians">
            <GuardiansTab studentId={id} guardians={guardians} canManage={canManageStudents} />
          </TabsContent>

          <TabsContent value="documents">
            <DocumentsTab studentId={id} documents={documents} canUpload={canUploadDocuments} />
          </TabsContent>

          <TabsContent value="medical">
            <MedicalTab studentId={id} />
          </TabsContent>

          <TabsContent value="certificates">
            <CertificatesTab studentId={id} certificates={certificates} canIssue={canIssueCertificates} />
          </TabsContent>

          <TabsContent value="discipline">
            <DisciplineTab studentId={id} records={disciplineRecords} canWrite={canWriteDiscipline} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
