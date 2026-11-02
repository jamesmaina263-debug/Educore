import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { ApprovalsInbox } from "@/components/approvals/approvals-inbox";
import { getSchoolSlug } from "@/lib/school-slug-server";
import {
  APPROVAL_KINDS,
  APPROVAL_KIND_ORDER,
  mapDiscounts,
  mapExpenses,
  mapLeave,
  mapRequisitions,
  sortOldestFirst,
  type ApprovalItem,
  type ApprovalKind,
  type DiscountRow,
  type ExpenseRow,
  type LeaveRow,
  type NameMap,
  type RequisitionRow,
} from "@/lib/approvals-inbox";

const LIMIT = 100;

async function names(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: "school_users" | "students" | "leave_types",
  ids: (string | null)[],
  column: "full_name" | "name" | "first_name",
): Promise<NameMap> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map();
  if (table === "students") {
    const { data } = await supabase.from("students").select("id, first_name, last_name").in("id", unique);
    return new Map((data ?? []).map((r) => [r.id as string, `${r.first_name} ${r.last_name}`.trim()]));
  }
  const { data } = await supabase.from(table).select(`id, ${column}`).in("id", unique);
  return new Map(((data ?? []) as unknown as Record<string, string>[]).map((r) => [r.id, r[column]]));
}

export default async function ApprovalsPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");
  const schoolSlug = await getSchoolSlug();

  const [{ data: me }, ...perms] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    ...APPROVAL_KIND_ORDER.map((k) => supabase.rpc("auth_has_permission", { p_permission_key: APPROVAL_KINDS[k].permission })),
  ]);
  const allowed = APPROVAL_KIND_ORDER.filter((_, i) => perms[i].data === true);
  const viewerId = (me?.id as string | undefined) ?? null;

  const failed: ApprovalKind[] = [];
  let items: ApprovalItem[] = [];

  // Every query below uses the person's own session, so row-level security decides what they can see;
  // the permission checks above only decide which sections are shown.
  const load = async (kind: ApprovalKind): Promise<ApprovalItem[]> => {
    try {
      if (kind === "leave") {
        const { data, error } = await supabase
          .from("leave_requests")
          .select("id, staff_id, leave_type_id, start_date, end_date, days_count, reason, created_at")
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(LIMIT);
        if (error) throw error;
        const rows = (data ?? []) as LeaveRow[];
        const [people, types] = await Promise.all([
          names(supabase, "school_users", rows.map((r) => r.staff_id), "full_name"),
          names(supabase, "leave_types", rows.map((r) => r.leave_type_id), "name"),
        ]);
        return mapLeave(rows, people, types, viewerId);
      }
      if (kind === "requisition") {
        const { data, error } = await supabase
          .from("purchase_requisitions")
          .select("id, purpose, requested_by, created_at")
          .eq("status", "submitted")
          .order("created_at", { ascending: true })
          .limit(LIMIT);
        if (error) throw error;
        const rows = (data ?? []) as RequisitionRow[];
        return mapRequisitions(rows, await names(supabase, "school_users", rows.map((r) => r.requested_by), "full_name"), viewerId);
      }
      if (kind === "expense") {
        const { data, error } = await supabase
          .from("expenses")
          .select("id, vendor, category, amount, description, requested_by, created_at")
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(LIMIT);
        if (error) throw error;
        const rows = (data ?? []) as ExpenseRow[];
        return mapExpenses(rows, await names(supabase, "school_users", rows.map((r) => r.requested_by), "full_name"), viewerId);
      }
      const { data, error } = await supabase
        .from("discounts")
        .select("id, student_id, amount, reason, requested_by, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(LIMIT);
      if (error) throw error;
      const rows = (data ?? []) as DiscountRow[];
      const [people, students] = await Promise.all([
        names(supabase, "school_users", rows.map((r) => r.requested_by), "full_name"),
        names(supabase, "students", rows.map((r) => r.student_id), "first_name"),
      ]);
      return mapDiscounts(rows, people, students, viewerId);
    } catch {
      failed.push(kind);
      return [];
    }
  };

  items = sortOldestFirst((await Promise.all(allowed.map(load))).flat());

  const roleName = (me?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (me?.schools as unknown as { name: string } | null)?.name;

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Approvals" }]}
      userName={me?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Approvals</h1>
          <p className="text-sm text-muted-foreground">
            What is waiting for your decision, oldest first. Review opens the screen where you approve or reject; nothing is decided here.
          </p>
        </div>
        <ApprovalsInbox items={items} allowed={allowed} failed={failed} schoolSlug={schoolSlug} now={new Date()} />
      </div>
    </AppShell>
  );
}
