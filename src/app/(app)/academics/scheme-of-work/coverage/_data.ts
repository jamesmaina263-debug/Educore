import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import {
  combineCoverage,
  compareUrgency,
  groupCoverage,
  nairobiToday,
  pickDefaultTerm,
  summariseScheme,
  type Coverage,
  type CoverageEntry,
  type CoverageGroup,
} from "@/lib/scheme-coverage";

export interface CoverageFilters {
  term?: string;
  class?: string;
  subject?: string;
  teacher?: string;
  /** "1" to include schemes still in draft (hidden by default: a draft is not a commitment yet). */
  drafts?: string;
}

export interface CoverageOption {
  id: string;
  label: string;
}

export interface CoverageSchemeRow {
  id: string;
  status: string;
  subject_name: string;
  class_name: string;
  stream_name: string | null;
  teacher_id: string;
  teacher_name: string;
  coverage: Coverage;
}

export interface CoverageDashboardContext {
  userName: string;
  userRole?: string;
  schoolName?: string;
  /** Holds scheme_of_work.review or scheme_of_work.write_any (principal, deputy principal, owner). */
  canView: boolean;
  /** True when a query failed: the page says so rather than showing misleading zeros. */
  loadError: boolean;
  today: string;
  term: { id: string; label: string; start_date: string; end_date: string } | null;
  termOptions: CoverageOption[];
  classOptions: CoverageOption[];
  subjectOptions: CoverageOption[];
  teacherOptions: CoverageOption[];
  filters: CoverageFilters;
  rows: CoverageSchemeRow[];
  byTeacher: CoverageGroup[];
  overall: Coverage;
}

const EMPTY_COVERAGE: Coverage = combineCoverage([]);

// PostgREST returns at most 1000 rows per request and long ?in=(...) lists overflow the URL, so
// lessons are read in chunks of schemes and pages of rows. A silent truncation here would make a
// big school look better covered than it is.
const SCHEME_CHUNK = 100;
const PAGE = 1000;

async function fetchEntries(supabase: SupabaseClient, schemeIds: string[]): Promise<Map<string, CoverageEntry[]>> {
  const byScheme = new Map<string, CoverageEntry[]>();
  for (let i = 0; i < schemeIds.length; i += SCHEME_CHUNK) {
    const chunk = schemeIds.slice(i, i + SCHEME_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("scheme_of_work_entries")
        .select("id, scheme_id, week_number, entry_date, completion_status")
        .in("scheme_id", chunk)
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const row of data ?? []) {
        const list = byScheme.get(row.scheme_id) ?? [];
        list.push({ week_number: row.week_number, entry_date: row.entry_date, completion_status: row.completion_status });
        byScheme.set(row.scheme_id, list);
      }
      if ((data ?? []).length < PAGE) break;
    }
  }
  return byScheme;
}

export async function loadCoverageDashboard(searchParams: CoverageFilters): Promise<CoverageDashboardContext> {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canReview }, { data: canWriteAny }, { data: moduleEnabled }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "scheme_of_work.review" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "scheme_of_work.write_any" }),
    supabase.rpc("auth_school_module_enabled", { p_key: "scheme_of_work" }),
  ]);
  // Same per-school module switch as the rest of Scheme of Work (fails safe to enabled).
  if (moduleEnabled === false) redirect("/dashboard");

  const today = nairobiToday();
  const base: CoverageDashboardContext = {
    userName: schoolUser?.full_name ?? user.email ?? "Account",
    userRole: (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name,
    schoolName: (schoolUser?.schools as unknown as { name: string } | null)?.name,
    canView: !!canReview || !!canWriteAny,
    loadError: false,
    today,
    term: null,
    termOptions: [],
    classOptions: [],
    subjectOptions: [],
    teacherOptions: [],
    filters: searchParams,
    rows: [],
    byTeacher: [],
    overall: EMPTY_COVERAGE,
  };
  if (!base.canView) return base;

  try {
    const [termsRes, classesRes, subjectsRes] = await Promise.all([
      supabase.from("terms").select("id, name, start_date, end_date, academic_years(name)").order("start_date", { ascending: false }),
      supabase.from("classes").select("id, name").order("level_order"),
      supabase.from("subjects").select("id, name").order("name"),
    ]);
    if (termsRes.error) throw termsRes.error;
    if (classesRes.error) throw classesRes.error;
    if (subjectsRes.error) throw subjectsRes.error;

    const terms = termsRes.data ?? [];
    const chosen =
      terms.find((t) => t.id === searchParams.term) ?? pickDefaultTerm(terms, today);
    const termLabel = (t: (typeof terms)[number]) =>
      `${(t.academic_years as unknown as { name: string } | null)?.name ?? ""} — ${t.name}`;

    const withOptions: CoverageDashboardContext = {
      ...base,
      termOptions: terms.map((t) => ({ id: t.id, label: termLabel(t) })),
      classOptions: (classesRes.data ?? []).map((c) => ({ id: c.id, label: c.name })),
      subjectOptions: (subjectsRes.data ?? []).map((s) => ({ id: s.id, label: s.name })),
      term: chosen
        ? { id: chosen.id, label: termLabel(chosen), start_date: chosen.start_date, end_date: chosen.end_date }
        : null,
    };
    if (!chosen) return withOptions;

    let query = supabase
      .from("schemes_of_work")
      .select(
        // Disambiguated embed: schemes_of_work has four FKs into school_users (see ../_data.ts).
        "id, status, class_id, stream_id, subject_id, teacher_id, subjects(name), classes(name), streams(name), school_users!schemes_of_work_teacher_id_fkey(full_name)",
      )
      .eq("term_id", chosen.id);
    if (searchParams.class) query = query.eq("class_id", searchParams.class);
    if (searchParams.subject) query = query.eq("subject_id", searchParams.subject);
    if (searchParams.teacher) query = query.eq("teacher_id", searchParams.teacher);
    if (searchParams.drafts !== "1") query = query.neq("status", "draft");

    const { data: schemes, error: schemesError } = await query;
    if (schemesError) throw schemesError;

    const entriesByScheme = await fetchEntries(
      supabase,
      (schemes ?? []).map((s) => s.id),
    );

    const rows: CoverageSchemeRow[] = (schemes ?? []).map((s) => ({
      id: s.id,
      status: s.status,
      subject_name: (s.subjects as unknown as { name: string } | null)?.name ?? "—",
      class_name: (s.classes as unknown as { name: string } | null)?.name ?? "—",
      stream_name: (s.streams as unknown as { name: string } | null)?.name ?? null,
      teacher_id: s.teacher_id,
      teacher_name: (s.school_users as unknown as { full_name: string } | null)?.full_name ?? "—",
      coverage: summariseScheme(entriesByScheme.get(s.id) ?? [], chosen.start_date, today),
    }));
    rows.sort((a, b) => compareUrgency(a.coverage, b.coverage) || a.subject_name.localeCompare(b.subject_name));

    // Teacher filter options come from the term's schemes (all statuses) so a teacher whose only
    // scheme is a draft can still be picked when drafts are shown.
    const { data: teacherRows, error: teacherError } = await supabase
      .from("schemes_of_work")
      .select("teacher_id, school_users!schemes_of_work_teacher_id_fkey(full_name)")
      .eq("term_id", chosen.id);
    if (teacherError) throw teacherError;
    const teacherMap = new Map<string, string>();
    for (const t of teacherRows ?? []) {
      teacherMap.set(t.teacher_id, (t.school_users as unknown as { full_name: string } | null)?.full_name ?? "—");
    }

    return {
      ...withOptions,
      teacherOptions: [...teacherMap.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
      rows,
      byTeacher: groupCoverage(rows.map((r) => ({ key: r.teacher_id, label: r.teacher_name, coverage: r.coverage }))),
      overall: combineCoverage(rows.map((r) => r.coverage)),
    };
  } catch (error) {
    console.error("[scheme-of-work/coverage] load failed", error);
    return { ...base, loadError: true };
  }
}
