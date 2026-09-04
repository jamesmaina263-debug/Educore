import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { StreamOption, TermOption, IndicatorOption, BandOption, RosterRatingRow } from "@/lib/academics/competency-appraisal-types";

export type { StreamOption, TermOption, IndicatorOption, BandOption, RosterRatingRow };

export interface CompetencyAppraisalContext {
  userName: string;
  userRole?: string;
  schoolName?: string;
  canWrite: boolean;
  canWriteAny: boolean;
  streamOptions: StreamOption[];
  termOptions: TermOption[];
  indicatorOptions: IndicatorOption[];
  selectedStreamId: string | null;
  selectedTermId: string | null;
  selectedIndicatorId: string | null;
  selectedTermStatus: TermOption["status"] | null;
  bandOptions: BandOption[];
  roster: RosterRatingRow[];
}

export async function loadCompetencyAppraisalContext(
  streamParam?: string,
  termParam?: string,
  indicatorParam?: string,
): Promise<CompetencyAppraisalContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canWriteAny }, { data: canWrite }] = await Promise.all([
    supabase
      .from("school_users")
      .select("id, full_name, school_id, roles(display_name), schools(name)")
      .eq("auth_user_id", user.id)
      .maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "competency_ratings.write_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "competency_ratings.write" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;
  const empty: CompetencyAppraisalContext = {
    userName: schoolUser?.full_name ?? user.email ?? "Account",
    userRole: roleName,
    schoolName,
    canWrite: false,
    canWriteAny: false,
    streamOptions: [],
    termOptions: [],
    indicatorOptions: [],
    selectedStreamId: null,
    selectedTermId: null,
    selectedIndicatorId: null,
    selectedTermStatus: null,
    bandOptions: [],
    roster: [],
  };

  if (!canWrite && !canWriteAny) return empty;

  // Streams this user can rate: their own (as class/homeroom teacher), or —
  // for leadership with write_any — every stream in the school. Mirrors the
  // same split /attendance uses for class_teacher_id scoping.
  const streamQuery = canWriteAny
    ? supabase.from("streams").select("id, name, classes(name, level_order)").order("name")
    : supabase
        .from("streams")
        .select("id, name, classes(name, level_order)")
        .eq("class_teacher_id", schoolUser?.id ?? "")
        .order("name");
  const [{ data: streamsRaw }, { data: termsRaw }, { data: indicatorsRaw }] = await Promise.all([
    streamQuery,
    supabase
      .from("terms")
      .select("id, name, status, start_date, academic_years(name)")
      .order("start_date", { ascending: false }),
    supabase
      .from("competency_indicators")
      .select("id, type, name, display_order")
      .eq("is_active", true)
      .order("type")
      .order("display_order"),
  ]);

  const streamOptions: StreamOption[] = (streamsRaw ?? []).map((s) => ({
    id: s.id,
    label: `${(s.classes as unknown as { name: string } | null)?.name ?? ""} ${s.name}`.trim(),
  }));

  const termOptions: TermOption[] = (termsRaw ?? []).map((t) => ({
    id: t.id,
    label: `${(t.academic_years as unknown as { name: string } | null)?.name ?? ""} — ${t.name}`.trim(),
    status: t.status as TermOption["status"],
  }));

  const indicatorOptions: IndicatorOption[] = (indicatorsRaw ?? []).map((i) => ({
    id: i.id,
    type: i.type as IndicatorOption["type"],
    name: i.name,
  }));

  const selectedStreamId = streamParam || streamOptions[0]?.id || null;
  const selectedTermId = termParam || termOptions.find((t) => t.status === "active")?.id || termOptions[0]?.id || null;
  const selectedIndicatorId = indicatorParam || indicatorOptions[0]?.id || null;
  const selectedTermStatus = termOptions.find((t) => t.id === selectedTermId)?.status ?? null;

  // Ensure a competency-model scale exists (idempotent), then load its bands.
  let bandOptions: BandOption[] = [];
  const { data: ensuredScaleId } = await supabase.rpc("ensure_default_competency_scale");
  if (ensuredScaleId) {
    const { data: bands } = await supabase
      .from("grading_scale_bands")
      .select("id, label, level_order")
      .eq("grading_scale_id", ensuredScaleId)
      .order("level_order");
    bandOptions = (bands ?? []).map((b) => ({ id: b.id, label: b.label }));
  }

  let roster: RosterRatingRow[] = [];
  if (selectedStreamId && selectedTermId && selectedIndicatorId) {
    const [{ data: students }, { data: existingRatings }] = await Promise.all([
      supabase
        .from("students")
        .select("id, admission_number, first_name, last_name")
        .eq("current_class_id", selectedStreamId)
        .eq("status", "active")
        .order("last_name"),
      supabase
        .from("competency_indicator_ratings")
        .select("id, student_id, band_id, observation")
        .eq("indicator_id", selectedIndicatorId)
        .eq("term_id", selectedTermId),
    ]);

    const existingByStudent = new Map(
      (existingRatings ?? []).map((r) => [r.student_id, { rating_id: r.id, band_id: r.band_id, observation: r.observation }]),
    );

    roster = (students ?? []).map((s) => ({
      student_id: s.id,
      admission_number: s.admission_number,
      full_name: `${s.first_name} ${s.last_name}`,
      existing: existingByStudent.get(s.id) ?? null,
    }));
  }

  return {
    ...empty,
    canWrite: !!canWrite,
    canWriteAny: !!canWriteAny,
    streamOptions,
    termOptions,
    indicatorOptions,
    selectedStreamId,
    selectedTermId,
    selectedIndicatorId,
    selectedTermStatus,
    bandOptions,
    roster,
  };
}
