import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { RecruitmentSection, type CandidateRow, type EventRow, type OpeningRow } from "@/components/recruitment/recruitment-section";
import { RECRUITMENT_FLAG, type EmploymentType, type OpeningStatus, type Stage } from "@/lib/recruitment";

export default async function RecruitmentPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  // Hidden entirely unless the school has the flag. hasFeatureFlag fails closed (any error => false).
  if (!(await hasFeatureFlag(supabase, RECRUITMENT_FLAG))) notFound();

  const [{ data: schoolUser }, { data: canManage }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "staff.manage" }),
  ]);
  // Candidate details are personal data: only people who manage staff may open this page.
  if (canManage !== true) notFound();

  const [{ data: openingRows }, { data: candidateRows }, { data: eventRows }] = await Promise.all([
    supabase
      .from("recruitment_openings")
      .select("id, title, department, employment_type, description, positions, closes_on, status, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("recruitment_candidates")
      .select("id, opening_id, full_name, email, phone, source, stage, stage_changed_at, created_at")
      .order("created_at", { ascending: true })
      .limit(2000),
    supabase
      .from("recruitment_events")
      .select("id, candidate_id, kind, from_stage, to_stage, body, created_at")
      .order("created_at", { ascending: true })
      .limit(5000),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  const openings: OpeningRow[] = (openingRows ?? []).map((o) => ({
    id: o.id as string,
    title: o.title as string,
    department: (o.department as string | null) ?? "",
    employmentType: o.employment_type as EmploymentType,
    description: (o.description as string | null) ?? "",
    positions: o.positions as number,
    closesOn: (o.closes_on as string | null) ?? null,
    status: o.status as OpeningStatus,
  }));
  const candidates: CandidateRow[] = (candidateRows ?? []).map((c) => ({
    id: c.id as string,
    openingId: c.opening_id as string,
    fullName: c.full_name as string,
    email: (c.email as string | null) ?? null,
    phone: (c.phone as string | null) ?? null,
    source: (c.source as string | null) ?? null,
    stage: c.stage as Stage,
    stageChangedAt: c.stage_changed_at as string,
  }));
  const events: EventRow[] = (eventRows ?? []).map((e) => ({
    id: e.id as string,
    candidateId: e.candidate_id as string,
    kind: e.kind as "stage" | "note",
    fromStage: (e.from_stage as Stage | null) ?? null,
    toStage: (e.to_stage as Stage | null) ?? null,
    body: (e.body as string | null) ?? null,
    createdAt: e.created_at as string,
  }));

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Staff", href: "/staff" }, { label: "Recruitment" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <RecruitmentSection openings={openings} candidates={candidates} events={events} today={new Date().toISOString().slice(0, 10)} />
    </AppShell>
  );
}
