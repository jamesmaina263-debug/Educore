import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { PerformanceSection, type ReviewRow, type StaffOption } from "@/components/performance/performance-section";

export default async function PerformancePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canReviewAny }, { data: canWrite }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "teacher_performance.read_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "teacher_performance.write" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  const [{ data: years }, { data: reviewRows }] = await Promise.all([
    supabase.from("academic_years").select("id").eq("status", "active"),
    supabase
      .from("teacher_performance_reviews")
      .select("id, teacher_id, review_type, competency_scores, overall_rating, notes, created_at, terms(name), school_users!teacher_performance_reviews_reviewer_id_fkey(full_name)")
      .order("created_at", { ascending: false }),
  ]);

  const activeYearId = years?.[0]?.id ?? "";
  const { data: terms } = activeYearId ? await supabase.from("terms").select("id, name").eq("academic_year_id", activeYearId) : { data: [] };

  let staffOptions: StaffOption[] = [];
  if (canReviewAny) {
    const { data: staff } = await supabase
      .from("school_users")
      .select("id, full_name, roles!inner(name)")
      .eq("status", "active")
      .in("roles.name", ["teacher", "class_teacher", "deputy_principal"]);
    staffOptions = (staff ?? []).map((s) => ({ id: s.id, full_name: s.full_name }));
  }

  const reviews: ReviewRow[] = (reviewRows ?? []).map((r) => ({
    id: r.id,
    teacher_id: r.teacher_id,
    reviewer_name: (r.school_users as unknown as { full_name: string } | null)?.full_name ?? "Unknown",
    review_type: r.review_type as "termly" | "annual",
    period_label: (r.terms as unknown as { name: string } | null)?.name ?? "Annual",
    competency_scores: (r.competency_scores as Record<string, number>) ?? {},
    overall_rating: r.overall_rating,
    notes: r.notes,
    created_at: r.created_at,
  }));

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Performance" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Teacher Performance</h1>
          <p className="text-sm text-muted-foreground">
            {canReviewAny ? "Periodic reviews across your teaching staff." : "Your performance reviews — visible to you and school leadership only."}
          </p>
        </div>

        <PerformanceSection
          reviews={reviews}
          staffOptions={staffOptions}
          academicYearId={activeYearId}
          terms={(terms ?? []) as { id: string; name: string }[]}
          canReview={canWrite === true}
          selfViewOnly={!canReviewAny}
        />
      </div>
    </AppShell>
  );
}
