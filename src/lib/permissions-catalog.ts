// Every key here is already enforced in RLS policies across the migrations
// (grep `auth_has_permission('...')` in supabase/migrations to verify). This
// file only adds human-readable grouping/labels for the Settings UI — it does
// not grant anything by itself. Keep it in sync if a new permission_key is
// introduced in a migration.

export interface PermissionDef {
  key: string;
  label: string;
}

export interface PermissionGroup {
  module: string;
  label: string;
  permissions: PermissionDef[];
}

export const PERMISSION_CATALOG: PermissionGroup[] = [
  {
    module: "students",
    label: "Students",
    permissions: [
      { key: "students.read", label: "View students" },
      { key: "students.write", label: "Add / edit students" },
      { key: "students.documents.read", label: "View student documents" },
      { key: "students.documents.write", label: "Upload / manage student documents" },
      { key: "students.medical.read", label: "View student medical records" },
      { key: "students.medical.write", label: "Edit student medical records" },
    ],
  },
  {
    module: "admissions",
    label: "Admissions",
    permissions: [
      { key: "admissions.read_any", label: "View all applications" },
      { key: "admissions.write", label: "Manage admissions / applications" },
    ],
  },
  {
    module: "academics",
    label: "Academics",
    permissions: [
      { key: "academics.read", label: "View academic structure (years, terms, classes, subjects)" },
      { key: "academics.write", label: "Manage academic structure" },
    ],
  },
  {
    module: "attendance",
    label: "Attendance",
    permissions: [
      { key: "attendance.read", label: "View attendance" },
      { key: "attendance.mark", label: "Mark attendance for own class" },
      { key: "attendance.mark_any", label: "Mark attendance for any class" },
      { key: "attendance.approve_correction", label: "Approve attendance corrections" },
    ],
  },
  {
    module: "exams",
    label: "Exams",
    permissions: [
      { key: "exams.read", label: "View exams" },
      { key: "exams.write", label: "Create / manage exams" },
    ],
  },
  {
    module: "marks",
    label: "Marks",
    permissions: [
      { key: "marks.write", label: "Enter marks for own class/subject" },
      { key: "marks.write_any", label: "Enter marks for any class/subject" },
      { key: "marks.approve", label: "Approve own marks entries" },
      { key: "marks.approve_any", label: "Approve any marks entries" },
    ],
  },
  {
    module: "report_cards",
    label: "Report Cards",
    permissions: [
      { key: "report_cards.approve", label: "Approve own report cards" },
      { key: "report_cards.approve_any", label: "Approve any report cards" },
    ],
  },
  {
    module: "certificates",
    label: "Certificates",
    permissions: [{ key: "certificates.write", label: "Issue certificates" }],
  },
  {
    module: "finance",
    label: "Finance",
    permissions: [
      { key: "finance.read", label: "View fees, invoices, payments" },
      { key: "finance.write", label: "Manage fees, invoices, payments" },
      { key: "discounts.approve", label: "Approve fee discounts / waivers" },
      { key: "expenses.approve", label: "Approve expenses" },
    ],
  },
  {
    module: "payroll",
    label: "Payroll",
    permissions: [
      { key: "payroll.read_any", label: "View payroll for any staff" },
      { key: "payroll.write", label: "Manage payroll" },
      { key: "payroll.approve", label: "Approve payroll runs" },
    ],
  },
  {
    module: "staff",
    label: "Staff",
    permissions: [
      { key: "staff.read", label: "View staff directory" },
      { key: "staff.manage", label: "Add / edit / deactivate staff, change roles" },
      { key: "staff.leave.approve", label: "Approve staff leave requests" },
    ],
  },
  {
    module: "staff_attendance",
    label: "Staff Attendance",
    permissions: [
      { key: "staff_attendance.read_any", label: "View staff attendance for anyone" },
      { key: "staff_attendance.mark", label: "Mark staff attendance" },
    ],
  },
  {
    module: "teacher_performance",
    label: "Teacher Performance",
    permissions: [
      { key: "teacher_performance.read_any", label: "View any teacher's performance reviews" },
      { key: "teacher_performance.write", label: "Write teacher performance reviews" },
    ],
  },
  {
    module: "discipline",
    label: "Discipline",
    permissions: [
      { key: "discipline.read_any", label: "View any discipline records" },
      { key: "discipline.write", label: "Log discipline incidents" },
      { key: "discipline.cases.manage", label: "Manage discipline cases" },
    ],
  },
  {
    module: "welfare",
    label: "Welfare",
    permissions: [
      { key: "welfare.read_any", label: "View welfare records" },
      { key: "welfare.write", label: "Manage welfare records" },
    ],
  },
  {
    module: "safeguarding",
    label: "Safeguarding",
    permissions: [
      { key: "safeguarding.read", label: "View safeguarding records" },
      { key: "safeguarding.write", label: "Manage safeguarding records" },
    ],
  },
  {
    module: "health",
    label: "Health / Nurse",
    permissions: [
      { key: "health.read_any", label: "View any student's health records" },
      { key: "health.write", label: "Manage health records" },
    ],
  },
  {
    module: "hostel",
    label: "Boarding / Hostel",
    permissions: [
      { key: "hostel.read_any", label: "View all boarding records" },
      { key: "hostel.read_assigned", label: "View own assigned house/dormitory records" },
      { key: "hostel.write", label: "Manage all boarding records" },
      { key: "hostel.write_assigned", label: "Manage own assigned house/dormitory records" },
    ],
  },
  {
    module: "transport",
    label: "Transport",
    permissions: [
      { key: "transport.read_any", label: "View transport records" },
      { key: "transport.write", label: "Manage transport records" },
    ],
  },
  {
    module: "library",
    label: "Library",
    permissions: [
      { key: "library.read_any", label: "View library records" },
      { key: "library.write", label: "Manage library records" },
    ],
  },
  {
    module: "inventory",
    label: "Inventory",
    permissions: [
      { key: "inventory.read_any", label: "View inventory" },
      { key: "inventory.write", label: "Manage inventory" },
      { key: "inventory.procurement.approve", label: "Approve procurement requests" },
      { key: "inventory.health.issue", label: "Issue inventory to health/nurse module" },
    ],
  },
  {
    module: "communication",
    label: "Communication",
    permissions: [
      { key: "communication.read", label: "View messages / newsletters" },
      { key: "communication.write", label: "Send messages / newsletters" },
    ],
  },
  {
    module: "ai",
    label: "AI Analytics",
    permissions: [{ key: "ai.read", label: "View AI analytics & insights" }],
  },
  {
    module: "audit",
    label: "Audit",
    permissions: [{ key: "audit.read", label: "View the audit log" }],
  },
  {
    module: "reports",
    label: "Reports",
    permissions: [{ key: "reports.read", label: "View reports & analytics" }],
  },
  {
    module: "billing",
    label: "Platform Billing",
    permissions: [
      { key: "billing.read", label: "View school's platform subscription/billing" },
      { key: "billing.manage", label: "Cancel the school's platform subscription" },
    ],
  },
  {
    module: "settings",
    label: "Settings",
    permissions: [
      { key: "settings.branding.write", label: "Edit school branding" },
      { key: "settings.roles.manage", label: "Manage roles & permissions" },
    ],
  },
  {
    module: "api",
    label: "API Access",
    permissions: [{ key: "api.manage", label: "Issue / revoke API keys" }],
  },
  {
    module: "group",
    label: "Multi-campus / Group",
    permissions: [
      { key: "group.branding.write", label: "Edit group-wide branding" },
      { key: "group.reports.read", label: "View cross-campus group reports" },
    ],
  },
  {
    module: "integrations",
    label: "Integrations",
    permissions: [
      { key: "nemis.manage", label: "Generate / confirm NEMIS submission batches" },
      { key: "mpesa.manage", label: "Configure M-Pesa credentials & activation" },
    ],
  },
];

export const ALL_PERMISSION_KEYS: string[] = PERMISSION_CATALOG.flatMap((g) => g.permissions.map((p) => p.key));

const LABEL_BY_KEY = new Map(ALL_PERMISSION_KEYS.map((key) => [key, PERMISSION_CATALOG.flatMap((g) => g.permissions).find((p) => p.key === key)!.label]));

export function getPermissionLabel(key: string): string {
  return LABEL_BY_KEY.get(key) ?? key;
}
