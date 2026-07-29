import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { Button } from "@/components/ui/button";
import { PipelineTable, type ApplicantRow, type StreamOption } from "@/components/admissions/pipeline-table";

export default async function AdmissionsPage() {
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

  const [{ data: applicants }, { data: streamRows }, { data: canReviewData }] = await Promise.all([
    supabase
      .from("students")
      .select("id, admission_number, first_name, last_name, status")
      .in("status", ["applied", "approved", "enrolled"])
      .order("status"),
    supabase.from("streams").select("id, name, classes(name)"),
    supabase.rpc("auth_has_permission", { p_permission_key: "students.write" }),
  ]);

  const rows: ApplicantRow[] = (applicants ?? []).map((a) => ({
    id: a.id,
    full_name: `${a.first_name} ${a.last_name}`,
    admission_number: a.admission_number,
    status: a.status as ApplicantRow["status"],
  }));

  const streams: StreamOption[] = (streamRows ?? []).map((s) => ({
    id: s.id,
    label: `${(s.classes as unknown as { name: string } | null)?.name ?? ""} ${s.name}`.trim(),
  }));

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  const counts = {
    applied: rows.filter((r) => r.status === "applied").length,
    approved: rows.filter((r) => r.status === "approved").length,
    enrolled: rows.filter((r) => r.status === "enrolled").length,
  };

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Admissions" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Admissions</h1>
            <p className="text-sm text-muted-foreground">
              {counts.applied} awaiting review · {counts.approved} approved · {counts.enrolled} enrolled, pending
              activation
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/students/new">New application</Link>
          </Button>
        </div>

        <PipelineTable rows={rows} streams={streams} canReview={canReviewData === true} />
      </div>
    </AppShell>
  );
}
