import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { ConnectSection, type ConnectItemRow, type ConnectStudentOption } from "@/components/connect/connect-section";

export default async function ConnectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canCreate }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "connect.create" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  // Students eligible for compose: only those in a stream this user is the class teacher of.
  // (Whether the button is even shown is gated on connect.create; this list is the further
  // per-student narrowing that create_connect_item() itself re-checks server-side.)
  let studentOptions: ConnectStudentOption[] = [];
  if (canCreate && schoolUser) {
    const { data: streams } = await supabase
      .from("streams")
      .select("id, name, classes(name)")
      .eq("class_teacher_id", schoolUser.id);
    const streamIds = (streams ?? []).map((s) => s.id);
    if (streamIds.length > 0) {
      const { data: students } = await supabase
        .from("students")
        .select("id, first_name, last_name, current_class_id")
        .in("current_class_id", streamIds)
        .eq("status", "active")
        .order("last_name");
      const streamLabel = new Map(
        (streams ?? []).map((s) => [s.id, `${(s.classes as unknown as { name: string } | null)?.name ?? ""} ${s.name}`.trim()]),
      );
      studentOptions = (students ?? []).map((s) => ({
        id: s.id,
        name: `${s.first_name} ${s.last_name}`,
        stream_label: streamLabel.get(s.current_class_id ?? "") ?? "",
      }));
    }
  }

  // RLS already scopes this to: connect.read_any holders see every item in the school,
  // everyone else sees only items they created. No further filtering needed here.
  const { data: itemRows } = await supabase
    .from("connect_items")
    .select(
      "id, created_by, category, title, body, due_date, requires_response, status, created_at, resolved_at, students(first_name, last_name), connect_item_recipients(read_at), connect_item_events(id, event_type, actor_role, body, old_status, new_status, created_at)",
    )
    .order("created_at", { ascending: false });

  const items: ConnectItemRow[] = (itemRows ?? []).map((i) => {
    const student = i.students as unknown as { first_name: string; last_name: string } | null;
    const recipients = (i.connect_item_recipients ?? []) as { read_at: string | null }[];
    const events = (i.connect_item_events ?? []) as {
      id: string;
      event_type: string;
      actor_role: string;
      body: string | null;
      old_status: string | null;
      new_status: string | null;
      created_at: string;
    }[];
    return {
      id: i.id,
      created_by: i.created_by,
      student_name: student ? `${student.first_name} ${student.last_name}` : "—",
      category: i.category,
      title: i.title,
      body: i.body,
      due_date: i.due_date,
      requires_response: i.requires_response,
      status: i.status,
      created_at: i.created_at,
      resolved_at: i.resolved_at,
      read_by_any: recipients.some((r) => r.read_at !== null),
      recipient_count: recipients.length,
      events: events
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((e) => ({
          id: e.id,
          event_type: e.event_type,
          actor_role: e.actor_role,
          body: e.body,
          old_status: e.old_status,
          new_status: e.new_status,
          created_at: e.created_at,
        })),
    };
  });

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Connect" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Connect</h1>
          <p className="text-sm text-muted-foreground">
            Structured messages to a specific student&apos;s guardians — not an open chat. Guardians can read, acknowledge, and
            reply on an item; only you can resolve one you created.
          </p>
        </div>
        <ConnectSection
          items={items}
          studentOptions={studentOptions}
          canCreate={canCreate === true}
          currentSchoolUserId={schoolUser?.id ?? null}
        />
      </div>
    </AppShell>
  );
}
