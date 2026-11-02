import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { HouseAssignmentSection } from "@/components/calendar/house-assignment-section";
import { CALENDAR_FLAG, type LearnerRow } from "@/lib/school-calendar";

const PAGE = 1000;

export default async function HouseAssignmentPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  // Hidden entirely unless the school has the flag. hasFeatureFlag fails closed (any error => false).
  if (!(await hasFeatureFlag(supabase, CALENDAR_FLAG))) notFound();

  const [{ data: schoolUser }, { data: canWrite }, { data: canRead }, { data: houseRows }, { data: memberRows }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.write" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.read" }),
    supabase.from("school_houses").select("id, name, colour, status").order("name", { ascending: true }),
    supabase.from("student_house_memberships").select("student_id, house_id").limit(20000),
  ]);
  if (canRead !== true && canWrite !== true) notFound();

  // Active and enrolled learners, fetched in pages so a big school is not cut off at the API row cap.
  type StudentRow = {
    id: string;
    admission_number: string | null;
    first_name: string;
    last_name: string;
    current_class_id: string | null;
    streams: { name: string; classes: { name: string } | { name: string }[] | null } | { name: string; classes: { name: string } | { name: string }[] | null }[] | null;
  };
  const students: StudentRow[] = [];
  for (let from = 0; from < 10 * PAGE; from += PAGE) {
    const { data } = await supabase
      .from("students")
      .select("id, admission_number, first_name, last_name, current_class_id, streams(name, classes(name))")
      .in("status", ["active", "enrolled"])
      .order("last_name", { ascending: true })
      .order("first_name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    const batch = (data ?? []) as unknown as StudentRow[];
    students.push(...batch);
    if (batch.length < PAGE) break;
  }

  const houseOf = new Map((memberRows ?? []).map((m) => [m.student_id as string, m.house_id as string]));
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const learners: LearnerRow[] = students.map((s) => {
    const stream = one(s.streams);
    const cls = stream ? one(stream.classes) : null;
    const label = stream ? `${cls?.name ?? ""} ${stream.name}`.trim() : "No class";
    return {
      id: s.id,
      name: `${s.first_name} ${s.last_name}`,
      admissionNumber: s.admission_number,
      classLabel: label,
      classKey: s.current_class_id ?? "",
      houseId: houseOf.get(s.id) ?? null,
    };
  });

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Calendar", href: "/calendar" }, { label: "House assignments" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">House assignments</h1>
          <p className="text-sm text-muted-foreground">Put learners into competition houses. Each learner is in one house at a time.</p>
        </div>
        <HouseAssignmentSection
          learners={learners}
          houses={(houseRows ?? []).map((h) => ({ id: h.id as string, name: h.name as string, colour: h.colour as string, status: h.status as "active" | "archived" }))}
          canWrite={canWrite === true}
        />
      </div>
    </AppShell>
  );
}
