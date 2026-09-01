import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { ParentsTable, type ParentRow } from "@/components/parents/parents-table";
import { deleteGuardianPermanentlyAction } from "./actions";

export default async function ParentsDirectoryPage() {
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

  // Guardian accounts are created the moment an online/walk-in application is
  // submitted, well before any admission decision -- that's how a parent logs in
  // to check status, respond to an interview, pay a deposit, etc. while their
  // application is still live. But this directory is the *permanent* record of
  // the school's parents, so it must only ever surface guardians whose child was
  // actually admitted -- student_guardians is only ever written on real enrollment
  // completion (see admission_enrollment_history), never on a bare application
  // decision. A guardian whose application was rejected/withdrawn, or is still
  // pending, has no row here and correctly stays out of this list -- their
  // account (and its PII) can still exist for portal login/audit purposes, but it
  // is not "stored" in the sense of appearing as one of the school's parents.
  const { data: guardianLinks } = await supabase
    .from("student_guardians")
    .select("guardian_user_id, students(first_name, last_name)");

  const childrenByParent = new Map<string, string[]>();
  for (const link of guardianLinks ?? []) {
    const student = link.students as unknown as { first_name: string; last_name: string } | null;
    if (!student) continue;
    const name = `${student.first_name} ${student.last_name}`;
    const list = childrenByParent.get(link.guardian_user_id) ?? [];
    list.push(name);
    childrenByParent.set(link.guardian_user_id, list);
  }

  const admittedGuardianIds = Array.from(childrenByParent.keys());

  const { data: parentRows } = admittedGuardianIds.length
    ? await supabase
        .from("school_users")
        .select("id, full_name, email, phone, status, roles!inner(name)")
        .eq("roles.name", "parent")
        .in("id", admittedGuardianIds)
        .order("full_name")
    : { data: [] };

  const { data: canDeleteGuardians } = await supabase.rpc("auth_has_permission", {
    p_permission_key: "guardians.delete",
  });

  const rows: ParentRow[] = (parentRows ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    email: p.email,
    phone: p.phone,
    status: p.status,
    children: childrenByParent.get(p.id) ?? [],
  }));

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Parents" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Parents directory</h1>
          <p className="text-sm text-muted-foreground">{rows.length} parent accounts</p>
        </div>

        {rows.length === 0 ? (
          <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
            No parent accounts yet.
          </div>
        ) : (
          <ParentsTable rows={rows} canDelete={!!canDeleteGuardians} deleteAction={deleteGuardianPermanentlyAction} />
        )}
      </div>
    </AppShell>
  );
}
