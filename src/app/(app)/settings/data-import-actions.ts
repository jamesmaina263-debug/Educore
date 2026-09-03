"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateTemporaryPassword, temporaryPasswordExpiry } from "@/lib/temporary-password";
import {
  IMPORT_SHEET_ORDER,
  IMPORT_SHEET_HEADERS,
  type ImportSheetName,
  type RawImportRow,
  type RawImportSheets,
  type ImportOutcome,
  type ImportRowResult,
  type ImportSheetResult,
} from "./data-import-shared";

// SD-10 (GTM Readiness Protocol): school-level data import — the counterpart to
// exportSchoolData() (data-export-actions.ts), for a school onboarding onto EduCore
// from another system. Same scope as export minus Invoices/Payments (see the SD-10
// migration comment for why those are out for v1), plus Staff, which export doesn't
// need to sequence but import does since a staff row needs a real auth account.
//
// Column headers below are deliberately identical to exportSchoolData()'s sheet
// headers, so a school's own EduCore export -- or another school's, for a
// group-to-group move -- can be re-uploaded here with zero editing. A school
// migrating from a *different* system just needs to relabel their existing
// spreadsheet's columns to match; downloadImportTemplate() below gives them a
// blank starter file with the right headers and one worked example row.
//
// Import order is fixed and enforced here, not left to the caller: Academic Years
// -> Terms -> Classes -> Streams -> Subjects -> Staff -> Students -> Guardians.
// Each stage resolves its parent records by name within the school (see the SQL
// functions), so a sheet that's missing or empty is simply skipped -- a school
// with no historical Guardians data, say, can still import everything else.

const EXAMPLE_ROWS: Record<ImportSheetName, (string | number)[]> = {
  "Academic Years": ["2027", "2027-01-01", "2027-11-30", "active"],
  Terms: ["2027", "Term 1", 1, "2027-01-01", "2027-04-10", "active"],
  Classes: ["Grade 9", 9, "2027"],
  Streams: ["2027", "Grade 9", "North", 40],
  Subjects: ["Mathematics", "Yes"],
  Staff: ["Jane Wanjiku", "Teacher", "jane.wanjiku@example.com", "0712345678", "Class Teacher", "Academics", "T-014", "2024-01-15", "active"],
  Students: ["ADM-0142", "UPI00142", "Grace", "Achieng", "", "2011-03-14", "female", "Grade 9", "North", "active", "2027-01-10"],
  Guardians: ["ADM-0142", "Mary Achieng", "mother", "Yes", "0712345678", "mary.achieng@example.com"],
};

function normalize(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Case/spacing-insensitive lookup of a row's value by its export-style header label. */
function pick(row: RawImportRow, header: string): string {
  const target = normalize(header);
  for (const [k, v] of Object.entries(row)) {
    if (normalize(k) === target) return typeof v === "string" ? v.trim() : String(v ?? "").trim();
  }
  return "";
}

function toJsonRows(rows: RawImportRow[], fields: Record<string, string>): Record<string, string>[] {
  // fields maps the RPC's expected JSON key -> the export-style header to read it from.
  return rows.map((row) => Object.fromEntries(Object.entries(fields).map(([key, header]) => [key, pick(row, header)])));
}

async function downloadTemplateWorkbook() {
  const { buildXlsxWorkbook } = await import("@/lib/xlsx-export");
  return buildXlsxWorkbook(
    IMPORT_SHEET_ORDER.map((name) => ({
      name,
      headers: IMPORT_SHEET_HEADERS[name],
      rows: [EXAMPLE_ROWS[name]],
    })),
  );
}

/** Server-side building of the starter template, so the client component doesn't need to duplicate headers/examples. */
export async function downloadImportTemplateAction(): Promise<{ error: string } | { success: true; base64: string }> {
  try {
    const buffer = await downloadTemplateWorkbook();
    return { success: true, base64: Buffer.from(buffer).toString("base64") };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not build the template." };
  }
}

async function runRpc(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fn: string,
  rows: Record<string, string>[],
): Promise<ImportRowResult[]> {
  if (rows.length === 0) return [];
  const { data, error } = await supabase.rpc(fn, { p_rows: rows });
  if (error) return [{ rowNumber: 0, status: "error", message: error.message }];
  return ((data as { row_number: number; status: "ok" | "error"; message: string }[]) ?? []).map((r) => ({
    rowNumber: r.row_number,
    status: r.status,
    message: r.message,
  }));
}

async function importStaffSheet(
  supabase: Awaited<ReturnType<typeof createClient>>,
  schoolId: string,
  rows: RawImportRow[],
): Promise<ImportRowResult[]> {
  if (rows.length === 0) return [];

  const { data: canManage } = await supabase.rpc("auth_has_permission", { p_permission_key: "staff.manage" });
  if (!canManage) {
    return [{ rowNumber: 0, status: "error", message: "You don't have permission to import staff." }];
  }

  const { data: roles } = await supabase.from("roles").select("id, display_name");
  const roleByName = new Map((roles ?? []).map((r) => [normalize(r.display_name), r.id as string]));

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch (e) {
    return [{ rowNumber: 0, status: "error", message: e instanceof Error ? e.message : "Admin client is not configured." }];
  }

  const results: ImportRowResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 1;
    const full_name = pick(rows[i], "Full Name");
    const email = pick(rows[i], "Email");
    const roleLabel = pick(rows[i], "Role");
    const phone = pick(rows[i], "Phone") || null;
    const position = pick(rows[i], "Position") || null;
    const department = pick(rows[i], "Department") || null;
    const staff_number = pick(rows[i], "Staff No.") || null;
    const hire_date = pick(rows[i], "Hire Date") || null;
    const status = (pick(rows[i], "Status") || "active").toLowerCase();

    if (!full_name || !email) {
      results.push({ rowNumber, status: "error", message: "Full Name and Email are required." });
      continue;
    }
    const role_id = roleByName.get(normalize(roleLabel));
    if (!role_id) {
      results.push({ rowNumber, status: "error", message: `No role found matching "${roleLabel || "(blank)"}".` });
      continue;
    }

    // Idempotent re-upload: an existing school_users row for this email is updated
    // in place rather than creating a second auth account for the same person.
    const { data: existing } = await supabase
      .from("school_users")
      .select("id")
      .eq("school_id", schoolId)
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      const { error: updateError } = await supabase
        .from("school_users")
        .update({ full_name, phone, position, department, staff_number, hire_date, role_id, status })
        .eq("id", existing.id);
      results.push(
        updateError
          ? { rowNumber, status: "error", message: updateError.message }
          : { rowNumber, status: "ok", message: `${full_name} updated (already had an account).` },
      );
      continue;
    }

    const temporaryPassword = generateTemporaryPassword();
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
    });
    if (createError || !created.user) {
      results.push({ rowNumber, status: "error", message: createError?.message ?? "Could not create the staff account." });
      continue;
    }

    const { error: linkError } = await supabase.from("school_users").insert({
      auth_user_id: created.user.id,
      school_id: schoolId,
      role_id,
      full_name,
      email,
      phone,
      position,
      department,
      staff_number,
      hire_date,
      status,
      must_change_password: true,
      temp_password_expires_at: temporaryPasswordExpiry(),
    });
    if (linkError) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      results.push({ rowNumber, status: "error", message: linkError.message });
      continue;
    }
    results.push({ rowNumber, status: "ok", message: `${full_name} imported (temporary password: ${temporaryPassword}).` });
  }
  return results;
}

/**
 * Runs every sheet present in `sheets` through its import stage, in the fixed
 * dependency order, and returns per-sheet per-row results. Missing/empty
 * sheets are skipped, not errored — a partial file (e.g. Students +
 * Guardians only, because Academic structure already exists) is valid.
 */
export async function importSchoolData(sheets: RawImportSheets): Promise<ImportOutcome> {
  const supabase = await createClient();
  const { data: canImport } = await supabase.rpc("auth_has_permission", { p_permission_key: "settings.data_import" });
  if (!canImport) return { error: "You don't have permission to import school data." };

  const { data: schoolId, error: schoolIdError } = await supabase.rpc("auth_school_id");
  if (schoolIdError || !schoolId) return { error: "Could not resolve your school." };

  const totalRows = Object.values(sheets).reduce((n, rows) => n + (rows?.length ?? 0), 0);
  if (totalRows === 0) return { error: "No rows found in that file." };
  if (totalRows > 8000) return { error: "Too many rows across the file (max 8000 total) -- split it and import in batches." };

  const out: ImportSheetResult[] = [];

  const years = sheets["Academic Years"] ?? [];
  out.push({
    sheet: "Academic Years",
    results: await runRpc(
      supabase,
      "bulk_import_academic_years",
      toJsonRows(years, { name: "Name", start_date: "Start Date", end_date: "End Date", status: "Status" }),
    ),
  });

  const terms = sheets.Terms ?? [];
  out.push({
    sheet: "Terms",
    results: await runRpc(
      supabase,
      "bulk_import_terms",
      toJsonRows(terms, {
        academic_year_name: "Academic Year",
        name: "Name",
        term_number: "Term No.",
        start_date: "Start Date",
        end_date: "End Date",
        status: "Status",
      }),
    ),
  });

  const classes = sheets.Classes ?? [];
  out.push({
    sheet: "Classes",
    results: await runRpc(
      supabase,
      "bulk_import_classes",
      toJsonRows(classes, { academic_year_name: "Academic Year", name: "Name", level_order: "Level Order" }),
    ),
  });

  const streams = sheets.Streams ?? [];
  out.push({
    sheet: "Streams",
    results: await runRpc(
      supabase,
      "bulk_import_streams",
      toJsonRows(streams, {
        academic_year_name: "Academic Year",
        class_name: "Class",
        stream_name: "Stream Name",
        capacity: "Capacity",
      }),
    ),
  });

  const subjects = sheets.Subjects ?? [];
  out.push({
    sheet: "Subjects",
    results: await runRpc(supabase, "bulk_import_subjects", toJsonRows(subjects, { name: "Name", is_active: "Active" })),
  });

  const staff = sheets.Staff ?? [];
  out.push({ sheet: "Staff", results: await importStaffSheet(supabase, schoolId as string, staff) });

  const students = sheets.Students ?? [];
  out.push({
    sheet: "Students",
    results: await runRpc(
      supabase,
      "bulk_import_students",
      toJsonRows(students, {
        admission_number: "Admission No.",
        upi_number: "UPI No.",
        first_name: "First Name",
        last_name: "Last Name",
        other_names: "Other Names",
        date_of_birth: "DOB",
        gender: "Gender",
        class_name: "Class",
        stream_name: "Stream",
        status: "Status",
        admission_date: "Admission Date",
      }),
    ),
  });

  const guardians = sheets.Guardians ?? [];
  out.push({
    sheet: "Guardians",
    results: await runRpc(
      supabase,
      "bulk_import_guardians",
      toJsonRows(guardians, {
        student_admission_number: "Student Adm. No.",
        guardian_full_name: "Guardian Name",
        guardian_phone: "Phone",
        guardian_email: "Email",
        relationship: "Relationship",
        primary_contact: "Primary Contact",
      }),
    ),
  });

  // Best-effort audit trail; the import itself has already run either way.
  await supabase.rpc("log_school_data_import", {
    p_dataset_names: out.filter((s) => s.results.length > 0).map((s) => s.sheet),
    p_row_counts: Object.fromEntries(out.map((s) => [s.sheet, s.results.length])),
  });

  revalidatePath("/students");
  revalidatePath("/staff");
  revalidatePath("/academics", "layout");
  revalidatePath("/settings", "layout");

  return { success: true, sheets: out };
}
