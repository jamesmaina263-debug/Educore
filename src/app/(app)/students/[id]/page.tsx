import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GuardiansTab, type GuardianRow } from "./guardians-tab";
import { DocumentsTab, type DocumentRow } from "@/components/documents-tab";
import { MedicalTab } from "./medical-tab";
import { CertificatesTab, type CertificateRow } from "./certificates-tab";
import { DisciplineTab, type DisciplineRow } from "./discipline-tab";
import { BiometricTab, type BiometricProfileRow, type BiometricCredentialRow, type BiometricDeviceOption } from "@/components/biometric/biometric-tab";
import { StudentStatusControl } from "@/components/students/student-status-control";
import { StudentDeleteControl } from "@/components/students/student-delete-control";
import { NemisIdentifiersCard } from "@/components/students/nemis-identifiers-card";
import { PathwayFitCard } from "@/components/students/pathway-fit-card";
import { computePathwayFit, type PathwayFitMarkInput } from "@/lib/academics/pathway-fit";
import { getStudentGrowth } from "./growth-actions";
import { GrowthTab } from "./growth-tab";
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
      "id, admission_number, upi_number, birth_certificate_number, nemis_sync_status, nemis_synced_at, nemis_notes, first_name, last_name, other_names, date_of_birth, gender, status, admission_date, streams(name, class_id, classes(name))",
    )
    .eq("id", id)
    .maybeSingle();

  if (!student) notFound();

  // Traceability (Brief 4.16.13): the only link back is applications.resulting_student_id, set
  // once by Complete Enrollment (Phase 13) — never duplicated onto the student row itself.
  const studentStream = student.streams as unknown as { name: string; class_id: string; classes: { name: string } | null } | null;
  const studentClassName = studentStream?.classes?.name ?? null;

  // Pathway guidance (Phase 6 of the CBC/CBE investigation) only makes sense at the pre-Senior-School
  // decision point -- matched on classes.name the same way the pathway-guidance roster page's default
  // does, since there's no canonical grade-number column. RLS on `marks` already scopes what comes back
  // to what this viewer (staff or guardian) is allowed to see, so no extra permission check is needed here.
  const showsPathwayFit = !!studentClassName && /grade\s*9\b/i.test(studentClassName);
  const { data: pathwayMarkRows } = showsPathwayFit
    ? await supabase
        .from("marks")
        .select(
          "subject_id, exam_id, raw_score, band_id, subjects(name, is_core, subject_catalogue(pathway)), grading_scale_bands(label)",
        )
        .eq("student_id", id)
        .eq("class_id", studentStream!.class_id)
    : { data: null };

  const { data: pathwayExamSubjectRows } = showsPathwayFit && studentStream
    ? await supabase.from("exam_subjects").select("exam_id, subject_id, max_score").eq("class_id", studentStream.class_id)
    : { data: null };

  const pathwayMaxScoreByKey = new Map<string, number>();
  for (const es of pathwayExamSubjectRows ?? []) {
    pathwayMaxScoreByKey.set(`${es.exam_id}|${es.subject_id}`, es.max_score as number);
  }

  const pathwayFitSummary = showsPathwayFit
    ? computePathwayFit(
        (pathwayMarkRows ?? []).flatMap((m): PathwayFitMarkInput[] => {
          const subject = m.subjects as unknown as {
            name: string;
            is_core: boolean;
            subject_catalogue: { pathway: string } | null;
          } | null;
          const band = m.grading_scale_bands as unknown as { label: string } | null;
          if (!subject) return [];
          return [
            {
              subjectId: m.subject_id,
              subjectName: subject.name,
              pathway: subject.subject_catalogue?.pathway ?? null,
              isCore: subject.is_core,
              rawScore: m.raw_score,
              maxScore: pathwayMaxScoreByKey.get(`${m.exam_id}|${m.subject_id}`) ?? null,
              bandLabel: band?.label ?? null,
            },
          ];
        }),
      )
    : null;

  const { data: originatingApplication } = await supabase
    .from("applications")
    .select("id, application_number")
    .eq("resulting_student_id", id)
    .maybeSingle();

  const growthSummary = await getStudentGrowth(id);

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
    .select("id, category, file_name, storage_path, storage_bucket, created_at")
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
  const canDeleteStudents = (await supabase.rpc("auth_has_permission", { p_permission_key: "students.delete" })).data === true;
  const canUploadDocuments = (await supabase.rpc("auth_has_permission", { p_permission_key: "students.documents.write" })).data === true;
  const canReadMedical = (await supabase.rpc("auth_has_permission", { p_permission_key: "students.medical.read" })).data === true;
  const canReadDiscipline = (await supabase.rpc("auth_has_permission", { p_permission_key: "discipline.read_any" })).data === true;
  const canReadFinance = (await supabase.rpc("auth_has_permission", { p_permission_key: "finance.read" })).data === true;
  const canIssueCertificates = (await supabase.rpc("auth_has_permission", { p_permission_key: "certificates.write" })).data === true;
  const canWriteDiscipline = (await supabase.rpc("auth_has_permission", { p_permission_key: "discipline.write" })).data === true;
  const canViewBiometric = (await supabase.rpc("auth_has_permission", { p_permission_key: "biometric.view" })).data === true;
  const canEnrollBiometric = (await supabase.rpc("auth_has_permission", { p_permission_key: "biometric.enroll" })).data === true;
  const canRevokeBiometric = (await supabase.rpc("auth_has_permission", { p_permission_key: "biometric.revoke" })).data === true;
  const canSeeBiometricTab = canViewBiometric || canEnrollBiometric || canRevokeBiometric;

  const { data: biometricProfileRow } = await supabase
    .from("biometric_profiles")
    .select("id, status")
    .eq("person_type", "student")
    .eq("person_id", id)
    .maybeSingle();
  const biometricProfile: BiometricProfileRow | null = biometricProfileRow as BiometricProfileRow | null;

  const { data: biometricCredentialRows } = biometricProfile
    ? await supabase
        .from("biometric_credentials")
        .select("id, credential_type, provider, status, enrolled_at, revoked_at, biometric_devices(name)")
        .eq("profile_id", biometricProfile.id)
        .order("enrolled_at", { ascending: false })
    : { data: null };
  const biometricCredentials: BiometricCredentialRow[] = (biometricCredentialRows ?? []).map((c) => ({
    id: c.id,
    credential_type: c.credential_type,
    provider: c.provider,
    status: c.status,
    enrolled_at: c.enrolled_at,
    revoked_at: c.revoked_at,
    device_name: (c.biometric_devices as unknown as { name: string } | null)?.name ?? null,
  }));

  const { data: biometricDeviceRows } = canEnrollBiometric
    ? await supabase.from("biometric_devices").select("id, name, location").eq("status", "active").order("name")
    : { data: null };
  const biometricDevices: BiometricDeviceOption[] = biometricDeviceRows ?? [];

  // Gap 5 (audit): post-enrollment handoff. Nothing previously enforced who confirms
  // documents/health/biometrics/invoice are truly squared away once complete_enrollment()
  // runs. This reuses the same check_admission_checklist() the wizard's Final Review and
  // Complete Enrollment steps already call — just surfaced here too, after enrollment, so
  // the person doing the handoff has one place to see open items. Only meaningful for
  // students who actually came through Admissions (originatingApplication set); a manually
  // created student never had a checklist to complete. Errors are swallowed to a null
  // rather than failing the whole profile page — this is a supplementary display, not a gate.
  const { data: handoffChecklist } = originatingApplication
    ? await supabase.rpc("check_admission_checklist", { p_application_id: originatingApplication.id })
    : { data: null };
  const biometricCaptured = biometricCredentials.some((c) => c.status === "active");

  // Overview tab: display-only aggregation pulled live from each module's own
  // authoritative table (Section 5.1) — nothing here is duplicated/stored on Students.
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const [
    { data: attendanceRows },
    { data: balanceRow },
    { data: boardingRow },
    { data: transportRow },
    { data: latestReportCard },
    { data: financialAccount },
  ] = await Promise.all([
    supabase
      .from("student_attendance")
      .select("status")
      .eq("student_id", id)
      .eq("session", "class")
      .gte("attendance_date", ninetyDaysAgo.toISOString().slice(0, 10)),
    supabase.from("v_student_balances").select("balance, credit_balance").eq("student_id", id).maybeSingle(),
    supabase
      .from("hostel_allocations")
      .select("hostel_rooms(room_number, block)")
      .eq("student_id", id)
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("student_transport_assignments")
      .select("pickup_point, transport_routes(name)")
      .eq("student_id", id)
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("report_cards")
      .select("id, generated_at, exams(name)")
      .eq("student_id", id)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("student_financial_accounts").select("payment_reference").eq("student_id", id).maybeSingle(),
  ]);

  const attendanceTotal = attendanceRows?.length ?? 0;
  const attendancePresent = (attendanceRows ?? []).filter((a) => a.status === "present").length;
  const attendanceRate = attendanceTotal > 0 ? Math.round((attendancePresent / attendanceTotal) * 100) : null;

  const boarding = boardingRow?.hostel_rooms as unknown as { room_number: string; block: string | null } | null;
  const transport = transportRow as unknown as {
    pickup_point: string | null;
    transport_routes: { name: string } | null;
  } | null;
  const latestExam = latestReportCard?.exams as unknown as { name: string } | null;

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;
  const fullName = [student.first_name, student.other_names, student.last_name].filter(Boolean).join(" ");
  const stream = studentStream;
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
              {student.admission_number ?? "Admission number pending enrollment"}
              {student.upi_number ? ` · UPI ${student.upi_number}` : ""}
            </p>
            {originatingApplication && (
              <p className="text-xs text-muted-foreground">Originated from Application {originatingApplication.application_number}</p>
            )}
          </div>
          <StatusBadge
            tone={student.status === "active" || student.status === "enrolled" ? "success" : "neutral"}
            label={student.status}
            className="ml-auto"
          />
          {canManageStudents && (
            <StudentStatusControl studentId={id} currentStatus={student.status} />
          )}
          {canDeleteStudents && (
            <StudentDeleteControl studentId={id} fullName={fullName} />
          )}
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
            <TabsTrigger value="growth">Growth</TabsTrigger>
            <TabsTrigger value="discipline">Discipline</TabsTrigger>
            {canSeeBiometricTab && <TabsTrigger value="biometric">Biometric</TabsTrigger>}
          </TabsList>

          <TabsContent value="overview" className="flex flex-col gap-6">
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

            <div className="grid grid-cols-2 gap-4 border-t border-border pt-6 sm:grid-cols-3">
              <div className="panel p-4">
                <p className="label-eyebrow">Attendance (90d)</p>
                <p className="mt-1 text-lg font-semibold">
                  {attendanceRate !== null ? `${attendanceRate}%` : "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {attendanceTotal > 0 ? `${attendancePresent}/${attendanceTotal} days present` : "No records yet"}
                </p>
              </div>

              <div className="panel p-4">
                <p className="label-eyebrow">Fee balance</p>
                {canReadFinance ? (
                  <>
                    <p className={`mt-1 text-lg font-semibold ${(balanceRow?.balance ?? 0) > 0 ? "text-danger" : "text-success"}`}>
                      {balanceRow ? `KES ${Number(balanceRow.balance).toLocaleString()}` : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {financialAccount ? `Ref. ${financialAccount.payment_reference}` : "From Finance"}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">Restricted</p>
                )}
              </div>

              <div className="panel p-4">
                <p className="label-eyebrow">Latest report card</p>
                <p className="mt-1 text-lg font-semibold">{latestExam?.name ?? "—"}</p>
                <p className="text-xs text-muted-foreground">From Exams</p>
              </div>

              <div className="panel p-4">
                <p className="label-eyebrow">Boarding</p>
                <p className="mt-1 text-lg font-semibold">
                  {boarding ? `Room ${boarding.room_number}` : "Day scholar"}
                </p>
                <p className="text-xs text-muted-foreground">{boarding?.block ? `Block ${boarding.block}` : "From Boarding"}</p>
              </div>

              <div className="panel p-4">
                <p className="label-eyebrow">Transport</p>
                <p className="mt-1 text-lg font-semibold">
                  {transport?.transport_routes?.name ?? "Not assigned"}
                </p>
                <p className="text-xs text-muted-foreground">{transport?.pickup_point ?? "From Transport"}</p>
              </div>

              {canReadDiscipline && (
                <div className="panel p-4">
                  <p className="label-eyebrow">Discipline</p>
                  <p className="mt-1 text-lg font-semibold">{disciplineRows?.length ?? 0} record(s) on file</p>
                  <p className="text-xs text-muted-foreground">
                    {disciplineRows?.[0] ? `Latest: ${disciplineRows[0].category}` : "None on file"}
                  </p>
                </div>
              )}

              {canViewBiometric && (
                <div className="panel p-4">
                  <p className="label-eyebrow">Biometric captured</p>
                  <p className={`mt-1 text-lg font-semibold ${biometricCaptured ? "text-success" : "text-warning"}`}>
                    {biometricCaptured ? "Yes" : "Not captured"}
                  </p>
                  <p className="text-xs text-muted-foreground">From Biometric</p>
                </div>
              )}

              {!canReadMedical && (
                <p className="col-span-full text-xs text-muted-foreground">
                  Health summary hidden — you don&apos;t have medical record access.
                </p>
              )}
            </div>

            {showsPathwayFit && pathwayFitSummary && <PathwayFitCard summary={pathwayFitSummary} />}

            {canManageStudents && originatingApplication && (
              <div className="panel p-4">
                <p className="label-eyebrow">Enrollment handoff checklist</p>
                {handoffChecklist && handoffChecklist.length > 0 ? (
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {handoffChecklist.map((item: { item: string; message: string }) => (
                      <li key={item.item} className="flex items-start gap-1.5 text-warning">
                        <span aria-hidden>•</span>
                        <span>{item.message}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-success">All enrollment checklist items complete.</p>
                )}
              </div>
            )}

            <NemisIdentifiersCard
              studentId={id}
              upiNumber={student.upi_number}
              birthCertificateNumber={student.birth_certificate_number}
              syncStatus={student.nemis_sync_status}
              syncedAt={student.nemis_synced_at}
              notes={student.nemis_notes}
              canManage={canManageStudents}
            />
          </TabsContent>

          <TabsContent value="guardians">
            <GuardiansTab studentId={id} guardians={guardians} canManage={canManageStudents} />
          </TabsContent>

          <TabsContent value="documents">
            <DocumentsTab ownerId={id} ownerType="student" documents={documents} canUpload={canUploadDocuments} />
          </TabsContent>

          <TabsContent value="medical">
            <MedicalTab studentId={id} />
          </TabsContent>

          <TabsContent value="certificates">
            <CertificatesTab studentId={id} certificates={certificates} canIssue={canIssueCertificates} />
          </TabsContent>

          <TabsContent value="growth">
            <GrowthTab summary={growthSummary} />
          </TabsContent>

          <TabsContent value="discipline">
            <DisciplineTab studentId={id} records={disciplineRecords} canWrite={canWriteDiscipline} />
          </TabsContent>

          {canSeeBiometricTab && (
            <TabsContent value="biometric">
              <BiometricTab
                personId={id}
                personType="student"
                profile={biometricProfile}
                credentials={biometricCredentials}
                devices={biometricDevices}
                canEnroll={canEnrollBiometric}
                canRevoke={canRevokeBiometric}
              />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </AppShell>
  );
}
