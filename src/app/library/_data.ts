import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  LibraryItemRow,
  LoanRow,
  StudentOption,
  StaffOption,
  ShelfOption,
  ReservationRow,
  FineRow,
} from "@/components/library/library-section";

export interface LibraryContext {
  userName: string;
  userRole?: string;
  schoolName: string;
  canReadAny: boolean;
  canWrite: boolean;
  items: LibraryItemRow[];
  loans: LoanRow[];
  studentOptions: StudentOption[];
  staffOptions: StaffOption[];
  shelfOptions: ShelfOption[];
  reservations: ReservationRow[];
  fines: FineRow[];
}

export async function loadLibraryContext(): Promise<LibraryContext> {
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
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name ?? "EduCore";

  const { data: itemRows } = await supabase.from("library_items").select("*, library_shelves(name)").order("title");
  const { data: loanRows } = await supabase
    .from("library_loans")
    .select(
      "id, library_item_id, student_id, staff_id, borrowed_at, due_date, returned_at, status, library_items(title), students(first_name, last_name), school_users!library_loans_staff_id_fkey(full_name)",
    )
    .order("borrowed_at", { ascending: false });

  let studentOptions: StudentOption[] = [];
  let staffOptions: StaffOption[] = [];
  let shelfOptions: ShelfOption[] = [];
  let reservations: ReservationRow[] = [];
  let fines: FineRow[] = [];

  if (canWrite) {
    const [{ data: students }, { data: staff }, { data: shelves }, { data: reservationRows }, { data: fineRows }] = await Promise.all([
      supabase.from("students").select("id, first_name, last_name, admission_number").eq("status", "active").order("first_name"),
      supabase.from("school_users").select("id, full_name, roles!inner(name)").eq("status", "active").not("roles.name", "in", "(parent,student,super_admin)"),
      supabase.from("library_shelves").select("id, name, location").order("name"),
      supabase
        .from("library_reservations")
        .select("id, library_item_id, status, reserved_at, library_items(title), students(first_name, last_name), school_users!library_reservations_staff_id_fkey(full_name)")
        .in("status", ["pending", "ready"])
        .order("reserved_at"),
      supabase
        .from("library_fines")
        .select("id, loan_id, amount, reason, status, created_at, library_loans(library_items(title), students(first_name, last_name), school_users!library_loans_staff_id_fkey(full_name))")
        .order("created_at", { ascending: false }),
    ]);
    studentOptions = (students ?? []).map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name} (${s.admission_number})` }));
    staffOptions = (staff ?? []).map((s) => ({ id: s.id, name: s.full_name }));
    shelfOptions = (shelves ?? []).map((s) => ({ id: s.id, name: s.name, location: s.location }));
    reservations = (reservationRows ?? []).map((r) => {
      const st = r.students as unknown as { first_name: string; last_name: string } | null;
      const staffMember = r.school_users as unknown as { full_name: string } | null;
      return {
        id: r.id,
        item_title: (r.library_items as unknown as { title: string } | null)?.title ?? "Unknown",
        library_item_id: r.library_item_id,
        borrower_name: st ? `${st.first_name} ${st.last_name}` : staffMember?.full_name ?? "Unknown",
        status: r.status as ReservationRow["status"],
        reserved_at: r.reserved_at,
      };
    });
    fines = (fineRows ?? []).map((f) => {
      const loan = f.library_loans as unknown as {
        library_items: { title: string } | null;
        students: { first_name: string; last_name: string } | null;
        school_users: { full_name: string } | null;
      } | null;
      const st = loan?.students;
      return {
        id: f.id,
        loan_id: f.loan_id,
        item_title: loan?.library_items?.title ?? "Unknown",
        borrower_name: st ? `${st.first_name} ${st.last_name}` : loan?.school_users?.full_name ?? "Unknown",
        amount: Number(f.amount),
        reason: f.reason,
        status: f.status as FineRow["status"],
        created_at: f.created_at,
      };
    });
  }

  const items: LibraryItemRow[] = (itemRows ?? []).map((i) => ({
    id: i.id,
    title: i.title,
    author: i.author,
    category: i.category,
    total_copies: i.total_copies,
    available_copies: i.available_copies,
    shelf_name: (i.library_shelves as unknown as { name: string } | null)?.name ?? null,
  }));

  const loans: LoanRow[] = (loanRows ?? []).map((l) => {
    const st = l.students as unknown as { first_name: string; last_name: string } | null;
    const staffMember = l.school_users as unknown as { full_name: string } | null;
    return {
      id: l.id,
      library_item_id: l.library_item_id,
      item_title: (l.library_items as unknown as { title: string } | null)?.title ?? "Unknown",
      borrower_name: st ? `${st.first_name} ${st.last_name}` : staffMember?.full_name ?? "Unknown",
      borrowed_at: l.borrowed_at,
      due_date: l.due_date,
      returned_at: l.returned_at,
      status: l.status as LoanRow["status"],
    };
  });

  return {
    userName: schoolUser?.full_name ?? user.email ?? "Account",
    userRole: roleName,
    schoolName,
    canReadAny: canReadAny === true,
    canWrite: canWrite === true,
    items,
    loans,
    studentOptions,
    staffOptions,
    shelfOptions,
    reservations,
    fines,
  };
}
