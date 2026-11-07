import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/bus-live";
import { getStudentPerformanceData } from "@/app/(app)/students/[id]/performance-actions";
import { PerformanceTab } from "@/app/(app)/students/[id]/performance-tab";

// Progress since enrolment for a parent (their linked children) or a student (themselves). Hidden (404) for any
// other account. The data comes from get_student_performance_marks(), which only returns marks the signed-in
// family could already read, so a result appears here only once the school has released that report card.
export default async function PortalProgressPage({ searchParams }: { searchParams: Promise<{ child?: string }> }) {
  const { child: childParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/parent-login");

  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("id, roles(name), schools(name, motto, logo_url, address, phone, email, primary_color)")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const roleName = (schoolUser?.roles as unknown as { name: string } | null)?.name;
  if (!schoolUser || (roleName !== "parent" && roleName !== "student")) notFound();
  const school = schoolUser.schools as unknown as { name: string; motto: string | null; logo_url: string | null; address: string | null; phone: string | null; email: string | null; primary_color: string | null } | null;

  type Learner = { id: string; first_name: string; last_name: string; admission_number: string | null; admission_date: string | null };
  let learners: Learner[] = [];
  if (roleName === "parent") {
    const { data: links } = await supabase.from("student_guardians").select("students(id, first_name, last_name, admission_number, admission_date)").eq("guardian_user_id", schoolUser.id);
    learners = (links ?? []).map((l) => l.students as unknown as Learner | null).filter((s): s is Learner => s !== null && isUuid(s.id));
  } else {
    const { data: own } = await supabase.from("students").select("id, first_name, last_name, admission_number, admission_date").eq("school_user_id", schoolUser.id);
    learners = (own ?? []).filter((s) => isUuid(s.id)) as Learner[];
  }
  const current = learners.find((l) => l.id === childParam) ?? learners[0] ?? null;
  const data = current ? await getStudentPerformanceData(current.id) : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 bg-background p-4">
      <Link href="/portal" className="text-xs text-muted-foreground underline">Back to portal</Link>
      <div className="panel space-y-4 p-4">
        <p className="label-eyebrow">Progress since enrolment</p>
        {learners.length > 1 && (
          <p className="flex flex-wrap gap-2 text-sm">
            {learners.map((l) => (
              <Link key={l.id} href={`/portal/progress?child=${l.id}`} className={`rounded border px-2 py-1 ${l.id === current?.id ? "bg-muted font-medium" : ""}`}>{l.first_name}</Link>
            ))}
          </p>
        )}
        {!current || !data ? (
          <p className="text-sm text-muted-foreground">Your child&apos;s information will appear here once the school has added it.</p>
        ) : (
          <>
            <PerformanceTab
              data={data}
              studentName={`${current.first_name} ${current.last_name}`}
              admissionNumber={current.admission_number}
              className={null}
              enrolledOn={current.admission_date}
              school={{
                name: school?.name ?? "School",
                motto: school?.motto ?? null,
                address: school?.address ?? null,
                phone: school?.phone ?? null,
                email: school?.email ?? null,
                primaryColor: school?.primary_color ?? null,
                logoUrl: school?.logo_url ?? null,
              }}
            />
            <p className="text-xs text-muted-foreground">Results appear here once the school has released the report card for that exam.</p>
          </>
        )}
      </div>
    </div>
  );
}
