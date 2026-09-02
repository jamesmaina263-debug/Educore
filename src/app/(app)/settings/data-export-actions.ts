"use server";

import { createClient } from "@/lib/supabase/server";

// SD-09 (GTM Readiness Protocol): school-level data export/portability.
//
// Deliberately scoped to the core administrative/enrollment/finance record — the
// data a school genuinely cannot reconstruct from anywhere else if it ever left the
// platform: Students, Guardians, Staff, academic structure (Years/Terms/Classes/
// Streams/Subjects), Invoices, and Payments. Module-specific operational data
// (attendance history, exam marks, health, discipline, library, transport, hostel,
// payroll, inventory, communications) already has its own per-module export where
// it exists (Reports, Attendance, Finance reconciliation, etc.) and is out of scope
// for this first version — a broader "everything" export can follow later if a
// school actually asks for one.
//
// All queries run through the normal RLS-scoped client (the caller's own session),
// never a service-role client — the export can only ever contain what the caller
// already has read access to.

export interface DataExportSheet {
  name: string;
  headers: string[];
  rows: (string | number)[][];
}

export interface DataExportResult {
  schoolName: string;
  generatedAt: string;
  sheets: DataExportSheet[];
}

export type DataExportOutcome = { error: string } | { success: true; data: DataExportResult };

function fmtDate(d: string | null | undefined): string {
  return d ?? "";
}

export async function exportSchoolData(): Promise<DataExportOutcome> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("school_id, schools(name)")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const schoolId = schoolUser?.school_id;
  if (!schoolId) return { error: "No active school found for your account." };
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name ?? "School";

  const [
    { data: students, error: studentsErr },
    { data: guardianLinks, error: guardiansErr },
    { data: staff, error: staffErr },
    { data: academicYears, error: yearsErr },
    { data: terms, error: termsErr },
    { data: classes, error: classesErr },
    { data: streams, error: streamsErr },
    { data: subjects, error: subjectsErr },
    { data: invoices, error: invoicesErr },
    { data: payments, error: paymentsErr },
  ] = await Promise.all([
    supabase
      .from("students")
      .select(
        "admission_number, upi_number, first_name, last_name, other_names, date_of_birth, gender, status, admission_date, streams:current_class_id(name)",
      )
      .order("admission_number"),
    supabase
      .from("student_guardians")
      .select(
        "relationship, primary_contact, students(admission_number, first_name, last_name), school_users:guardian_user_id(full_name, phone, email)",
      ),
    // staff_number is deliberately excluded from school_users' column-level SELECT grant
    // (see the "close staff statutory numbers read leak" migration) -- selecting it directly
    // here, even alongside ordinary columns, fails the whole query with "permission denied
    // for table school_users" for every caller, owner/principal included, since that's a
    // Postgres object-privilege error, not a row-level permission check. Fetched separately
    // below via get_staff_statutory_numbers(), the one sanctioned read path for that column.
    supabase
      .from("school_users")
      .select("id, full_name, email, phone, status, position, department, hire_date, roles(display_name)")
      .order("full_name"),
    supabase.from("academic_years").select("name, start_date, end_date, status").order("start_date"),
    supabase.from("terms").select("name, term_number, start_date, end_date, status, academic_years(name)").order("start_date"),
    supabase.from("classes").select("name, level_order, academic_years(name)").order("level_order"),
    supabase.from("streams").select("name, capacity, classes(name)").order("name"),
    supabase.from("subjects").select("name, code, is_core, is_active").order("name"),
    supabase
      .from("invoices")
      .select("students(admission_number, first_name, last_name), terms(name), total_amount, status, created_at")
      .order("created_at"),
    supabase
      .from("payments")
      .select("students(admission_number, first_name, last_name), amount, method, status, reference, recorded_at")
      .order("recorded_at"),
  ]);

  const firstError =
    studentsErr ||
    guardiansErr ||
    staffErr ||
    yearsErr ||
    termsErr ||
    classesErr ||
    streamsErr ||
    subjectsErr ||
    invoicesErr ||
    paymentsErr;
  if (firstError) return { error: firstError.message };

  // Staff numbers only, via the sanctioned RPC (see the school_users select above). Returns a
  // row only for staff the caller may see -- their own, or all of them with payroll.read_any
  // (which school_owner/principal hold by default) -- so this degrades to "blank for staff you
  // can't see" rather than erroring for a caller without that permission.
  const staffIds = (staff ?? []).map((s) => s.id as string);
  const { data: statutoryNumbers } = await supabase.rpc("get_staff_statutory_numbers", { p_staff_ids: staffIds });
  const staffNumberById = new Map(
    ((statutoryNumbers ?? []) as { staff_id: string; staff_number: string | null }[]).map((r) => [r.staff_id, r.staff_number]),
  );

  const sheets: DataExportSheet[] = [
    {
      name: "Students",
      headers: ["Admission No.", "UPI No.", "First Name", "Last Name", "Other Names", "DOB", "Gender", "Class/Stream", "Status", "Admission Date"],
      rows: (students ?? []).map((s) => [
        s.admission_number ?? "",
        s.upi_number ?? "",
        s.first_name ?? "",
        s.last_name ?? "",
        s.other_names ?? "",
        fmtDate(s.date_of_birth),
        s.gender ?? "",
        (s.streams as unknown as { name: string } | null)?.name ?? "",
        s.status ?? "",
        fmtDate(s.admission_date),
      ]),
    },
    {
      name: "Guardians",
      headers: ["Student Adm. No.", "Student Name", "Guardian Name", "Relationship", "Primary Contact", "Phone", "Email"],
      rows: (guardianLinks ?? []).map((g) => {
        const student = g.students as unknown as { admission_number: string; first_name: string; last_name: string } | null;
        const guardian = g.school_users as unknown as { full_name: string; phone: string | null; email: string | null } | null;
        return [
          student?.admission_number ?? "",
          student ? `${student.first_name} ${student.last_name}` : "",
          guardian?.full_name ?? "",
          g.relationship ?? "",
          g.primary_contact ? "Yes" : "No",
          guardian?.phone ?? "",
          guardian?.email ?? "",
        ];
      }),
    },
    {
      name: "Staff",
      headers: ["Full Name", "Role", "Email", "Phone", "Position", "Department", "Staff No.", "Hire Date", "Status"],
      rows: (staff ?? []).map((s) => [
        s.full_name ?? "",
        (s.roles as unknown as { display_name: string } | null)?.display_name ?? "",
        s.email ?? "",
        s.phone ?? "",
        s.position ?? "",
        s.department ?? "",
        staffNumberById.get(s.id as string) ?? "",
        fmtDate(s.hire_date),
        s.status ?? "",
      ]),
    },
    {
      name: "Academic Years",
      headers: ["Name", "Start Date", "End Date", "Status"],
      rows: (academicYears ?? []).map((y) => [y.name ?? "", fmtDate(y.start_date), fmtDate(y.end_date), y.status ?? ""]),
    },
    {
      name: "Terms",
      headers: ["Academic Year", "Name", "Term No.", "Start Date", "End Date", "Status"],
      rows: (terms ?? []).map((t) => [
        (t.academic_years as unknown as { name: string } | null)?.name ?? "",
        t.name ?? "",
        t.term_number ?? "",
        fmtDate(t.start_date),
        fmtDate(t.end_date),
        t.status ?? "",
      ]),
    },
    {
      name: "Classes",
      headers: ["Name", "Level Order", "Academic Year"],
      rows: (classes ?? []).map((c) => [
        c.name ?? "",
        c.level_order ?? "",
        (c.academic_years as unknown as { name: string } | null)?.name ?? "",
      ]),
    },
    {
      name: "Streams",
      headers: ["Class", "Stream Name", "Capacity"],
      rows: (streams ?? []).map((s) => [(s.classes as unknown as { name: string } | null)?.name ?? "", s.name ?? "", s.capacity ?? ""]),
    },
    {
      name: "Subjects",
      headers: ["Name", "Code", "Core", "Active"],
      rows: (subjects ?? []).map((s) => [s.name ?? "", s.code ?? "", s.is_core ? "Yes" : "No", s.is_active ? "Yes" : "No"]),
    },
    {
      name: "Invoices",
      headers: ["Student Adm. No.", "Student Name", "Term", "Total Amount (KES)", "Status", "Created At"],
      rows: (invoices ?? []).map((i) => {
        const student = i.students as unknown as { admission_number: string; first_name: string; last_name: string } | null;
        return [
          student?.admission_number ?? "",
          student ? `${student.first_name} ${student.last_name}` : "",
          (i.terms as unknown as { name: string } | null)?.name ?? "",
          i.total_amount ?? "",
          i.status ?? "",
          fmtDate(i.created_at),
        ];
      }),
    },
    {
      name: "Payments",
      headers: ["Student Adm. No.", "Student Name", "Amount (KES)", "Method", "Reference", "Status", "Recorded At"],
      rows: (payments ?? []).map((p) => {
        const student = p.students as unknown as { admission_number: string; first_name: string; last_name: string } | null;
        return [
          student?.admission_number ?? "",
          student ? `${student.first_name} ${student.last_name}` : "",
          p.amount ?? "",
          p.method ?? "",
          p.reference ?? "",
          p.status ?? "",
          fmtDate(p.recorded_at),
        ];
      }),
    },
  ];

  // Best-effort audit log entry — the export itself has already happened (the data
  // is in the response either way); this just records that it happened. Not
  // surfaced as an error to the user if it fails, since the export succeeded.
  await supabase.rpc("log_school_data_export", {
    p_dataset_names: sheets.map((s) => s.name),
    p_row_counts: Object.fromEntries(sheets.map((s) => [s.name, s.rows.length])),
  });

  return {
    success: true,
    data: { schoolName, generatedAt: new Date().toISOString(), sheets },
  };
}
