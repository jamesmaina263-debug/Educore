// Plain constants/types shared between data-import-actions.ts (a "use server" module)
// and data-import-panel.tsx (a client component).
//
// IMPORTANT: this file must NOT have a "use server" directive. Files with "use server"
// may only export async functions -- Next.js replaces any other export (consts, objects,
// etc.) with an opaque server-action reference at build time. IMPORT_SHEET_ORDER and
// IMPORT_SHEET_HEADERS are real values the client needs at runtime, so they have to live
// outside the server-actions module or the client sees a non-iterable stub instead of
// the actual array (this was the cause of the "new Set(...) function is not iterable"
// crash on /settings/data-import).

export type ImportRowResult = { rowNumber: number; status: "ok" | "error"; message: string };
export type ImportSheetResult = { sheet: string; results: ImportRowResult[] };
export type ImportOutcome = { error: string } | { success: true; sheets: ImportSheetResult[] };

/** Raw parsed rows as the client hands them over: one object per row, keyed by the exact header text in row 1. */
export type RawImportRow = Record<string, string>;
export type RawImportSheets = Partial<Record<ImportSheetName, RawImportRow[]>>;

export const IMPORT_SHEET_ORDER = [
  "Academic Years",
  "Terms",
  "Classes",
  "Streams",
  "Subjects",
  "Staff",
  "Students",
  "Guardians",
] as const;
export type ImportSheetName = (typeof IMPORT_SHEET_ORDER)[number];

// Sheet -> [display headers, in the same order as the export]. Used for both
// the template download and (loosely) for documenting expected columns; the
// actual header match below is case/spacing-insensitive.
export const IMPORT_SHEET_HEADERS: Record<ImportSheetName, string[]> = {
  "Academic Years": ["Name", "Start Date", "End Date", "Status"],
  Terms: ["Academic Year", "Name", "Term No.", "Start Date", "End Date", "Status"],
  Classes: ["Name", "Level Order", "Academic Year"],
  Streams: ["Academic Year", "Class", "Stream Name", "Capacity"],
  Subjects: ["Name", "Active"],
  Staff: ["Full Name", "Role", "Email", "Phone", "Position", "Department", "Staff No.", "Hire Date", "Status"],
  Students: [
    "Admission No.",
    "UPI No.",
    "First Name",
    "Last Name",
    "Other Names",
    "DOB",
    "Gender",
    "Class",
    "Stream",
    "Status",
    "Admission Date",
  ],
  Guardians: ["Student Adm. No.", "Guardian Name", "Relationship", "Primary Contact", "Phone", "Email"],
};
