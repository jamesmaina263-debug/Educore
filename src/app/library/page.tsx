import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { LibrarySection, type LibraryItemRow, type LoanRow, type StudentOption } from "@/components/library/library-section";

export default async function LibraryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canReadAny }, { data: canWrite }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "library.read_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "library.write" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  const { data: itemRows } = await supabase.from("library_items").select("*").order("title");
  const { data: loanRows } = await supabase
    .from("library_loans")
    .select("id, library_item_id, student_id, borrowed_at, due_date, returned_at, status, library_items(title), students(first_name, last_name)")
    .order("borrowed_at", { ascending: false });

  let studentOptions: StudentOption[] = [];
  if (canWrite) {
    const { data: students } = await supabase.from("students").select("id, first_name, last_name, admission_number").eq("status", "active").order("first_name");
    studentOptions = (students ?? []).map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name} (${s.admission_number})` }));
  }

  const items: LibraryItemRow[] = (itemRows ?? []).map((i) => ({
    id: i.id,
    title: i.title,
    author: i.author,
    category: i.category,
    total_copies: i.total_copies,
    available_copies: i.available_copies,
  }));

  const loans: LoanRow[] = (loanRows ?? []).map((l) => ({
    id: l.id,
    item_title: (l.library_items as unknown as { title: string } | null)?.title ?? "Unknown",
    student_name: (() => {
      const s = l.students as unknown as { first_name: string; last_name: string } | null;
      return s ? `${s.first_name} ${s.last_name}` : "Unknown";
    })(),
    borrowed_at: l.borrowed_at,
    due_date: l.due_date,
    returned_at: l.returned_at,
    status: l.status as "borrowed" | "returned" | "lost",
  }));

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Library" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Library</h1>
          <p className="text-sm text-muted-foreground">
            {canReadAny ? "Catalogue and loans across the school." : "Your borrowed items."}
          </p>
        </div>
        <LibrarySection items={items} loans={loans} studentOptions={studentOptions} canWrite={canWrite === true} />
      </div>
    </AppShell>
  );
}
