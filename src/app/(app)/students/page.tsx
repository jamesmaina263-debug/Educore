import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { StudentsTable, type StudentRow } from "@/components/students/students-table";
import { escapePostgrestOrValue } from "@/lib/postgrest-filter";

const PAGE_SIZE = 20;
const ENROLLED_STATUSES = ["active", "enrolled", "withdrawn", "transferred", "graduated"];

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
}) {
  const { page: pageParam, q, status } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const search = (q ?? "").trim();
  const statusFilter = status && ENROLLED_STATUSES.includes(status) ? status : null;

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

  // "applied" and "approved" are interim admission-in-progress statuses (student record
  // created early in the Admissions wizard for duplicate-detection/FK-linking purposes, but
  // Complete Enrollment hasn't run yet). This page is the school's actual student roster, so
  // it excludes those -- a student only shows up here once admission is fully completed.
  // Every post-enrollment status (including ones who later left) still shows unless narrowed
  // by the status filter below.
  //
  // Paginated + filtered server-side (2026-09-03 audit, finding A2): this previously fetched
  // every non-applicant student in the school on every page load with no .range()/.limit(),
  // then paginated client-side after the fact -- fine at pilot scale, not at 10k+ students.
  // { count: "exact" } costs a bit more than a plain select but is what makes real page
  // numbers ("Page 3 of 40") possible; worth revisiting to an estimated count if a school's
  // roster grows large enough for that cost to matter, which it isn't at today's scale.
  let query = supabase
    .from("students")
    .select("id, admission_number, first_name, last_name, status, current_class_id, streams(name, classes(name))", {
      count: "exact",
    })
    .not("status", "in", "(applied,approved)");

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }
  if (search) {
    // admission_number is exact-ish (short alphanumeric codes), so a plain ilike is fine
    // without needing pg_trgm; first/last name likewise for the name-search use case this
    // box is actually for. escapePostgrestOrValue matches the pattern already used in
    // finance/actions.ts and students/[id]/actions.ts -- PostgREST's .or() parses commas and
    // parens itself, so an unescaped search term could otherwise inject extra filter clauses.
    const term = escapePostgrestOrValue(`%${search}%`);
    query = query.or(
      `first_name.ilike.${term},last_name.ilike.${term},admission_number.ilike.${term}`,
    );
  }

  const from = (page - 1) * PAGE_SIZE;
  const { data: students, count } = await query
    .order("last_name")
    .range(from, from + PAGE_SIZE - 1);

  const studentIds = (students ?? []).map((s) => s.id);

  // Only fetches guardians for the ~20 students actually on this page, not the whole school --
  // this was the second unbounded query on this route (same audit finding).
  const { data: primaryGuardians } =
    studentIds.length > 0
      ? await supabase
          .from("student_guardians")
          .select("student_id, school_users(full_name)")
          .eq("primary_contact", true)
          .in("student_id", studentIds)
      : { data: [] };

  const guardianByStudent = new Map<string, string>();
  for (const g of primaryGuardians ?? []) {
    const name = (g.school_users as unknown as { full_name: string } | null)?.full_name;
    if (name) guardianByStudent.set(g.student_id as string, name);
  }

  const rows: StudentRow[] = (students ?? []).map((s) => {
    const stream = s.streams as unknown as { name: string; classes: { name: string } | null } | null;
    const classLabel = stream ? `${stream.classes?.name ?? ""} ${stream.name}`.trim() : null;
    return {
      id: s.id,
      admission_number: s.admission_number,
      full_name: `${s.first_name} ${s.last_name}`,
      status: s.status,
      class_label: classLabel,
      guardian_name: guardianByStudent.get(s.id) ?? null,
    };
  });

  const totalCount = count ?? 0;
  const isFiltered = Boolean(statusFilter || search);

  const roleName =
    (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Students" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Students</h1>
            <p className="text-sm text-muted-foreground">{totalCount} total</p>
          </div>
          {/* Students has no student-creation entry point of its own -- a real,
              live bug (phase-25 audit) came from a duplicate "Register student"
              path here that inserted directly into `students`, bypassing the
              entire Admissions pipeline. New students exist because an
              application was admitted; this page only ever displays that
              result, and the only way to start one is /admissions. */}
          <Link href="/admissions" className="text-sm text-primary underline underline-offset-2">
            Add a student via Admissions →
          </Link>
        </div>

        {totalCount === 0 && !isFiltered ? (
          <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
            No students in this school yet.
          </div>
        ) : (
          <StudentsTable rows={rows} totalCount={totalCount} pageSize={PAGE_SIZE} />
        )}
      </div>
    </AppShell>
  );
}
