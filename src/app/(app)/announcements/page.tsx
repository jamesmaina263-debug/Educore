import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import {
  AnnouncementsSection,
  type AnnouncementRow,
  type GradeOption,
  type StreamOption,
  type StudentOption,
} from "@/components/announcements/announcements-section";

export default async function AnnouncementsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canPublishSchoolWide }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "announcements.publish" }),
  ]);
  if (!schoolUser) redirect("/login");

  const roleName = (schoolUser.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser.schools as unknown as { name: string } | null)?.name;
  const canPublishAny = canPublishSchoolWide === true;

  const [{ data: classRows }, { data: streamRows }, { data: ownStreamRows }] = await Promise.all([
    supabase.from("classes").select("id, name, level_order").order("level_order"),
    supabase.from("streams").select("id, name, class_teacher_id, classes(name)").order("name"),
    supabase.from("streams").select("id").eq("class_teacher_id", schoolUser.id),
  ]);

  const ownStreamIds = new Set((ownStreamRows ?? []).map((s) => s.id));

  const grades: GradeOption[] = (classRows ?? []).map((c) => ({ id: c.id, name: c.name }));

  // Class-scope targets: everyone sees only their own stream(s) unless they hold
  // announcements.publish (leadership can target any class).
  const streams: StreamOption[] = (streamRows ?? [])
    .filter((s) => canPublishAny || ownStreamIds.has(s.id))
    .map((s) => ({
      id: s.id,
      label: `${(s.classes as unknown as { name: string } | null)?.name ?? ""} ${s.name}`.trim(),
    }));

  // Student-scope targets: own class's students unless leadership.
  let studentQuery = supabase.from("students").select("id, first_name, last_name, current_class_id").eq("status", "active").order("last_name");
  if (!canPublishAny) {
    const ids = Array.from(ownStreamIds);
    studentQuery = ids.length > 0 ? studentQuery.in("current_class_id", ids) : studentQuery.eq("current_class_id", "00000000-0000-0000-0000-000000000000");
  }
  const { data: studentRows } = await studentQuery;
  const streamLabelById = new Map(streams.map((s) => [s.id, s.label]));
  const students: StudentOption[] = (studentRows ?? []).map((s) => ({
    id: s.id,
    name: `${s.first_name} ${s.last_name}`,
    stream_label: streamLabelById.get(s.current_class_id ?? "") ?? "",
  }));

  // RLS already scopes this to: announcements.publish holders see every item in the
  // school, everyone else sees only ones they created (plus published ones they're a
  // recipient of, if they're also a guardian -- not relevant on the staff side).
  const { data: rows } = await supabase
    .from("announcements")
    .select(
      "id, created_by, title, body, urgency, scope, status, created_at, published_at, withdrawn_at, withdrawal_reason, classes(name), streams(name, classes(name)), students(first_name, last_name), announcement_recipients(read_at, acknowledged_at)",
    )
    .order("created_at", { ascending: false });

  const items: AnnouncementRow[] = (rows ?? []).map((r) => {
    const cls = r.classes as unknown as { name: string } | null;
    const stream = r.streams as unknown as { name: string; classes: { name: string } | null } | null;
    const student = r.students as unknown as { first_name: string; last_name: string } | null;
    const recipients = (r.announcement_recipients ?? []) as { read_at: string | null; acknowledged_at: string | null }[];
    let targetLabel = "Whole school";
    if (r.scope === "grade") targetLabel = cls?.name ?? "—";
    if (r.scope === "class") targetLabel = stream ? `${stream.classes?.name ?? ""} ${stream.name}`.trim() : "—";
    if (r.scope === "student") targetLabel = student ? `${student.first_name} ${student.last_name}` : "—";
    return {
      id: r.id,
      created_by: r.created_by,
      title: r.title,
      body: r.body,
      urgency: r.urgency,
      scope: r.scope,
      target_label: targetLabel,
      status: r.status,
      created_at: r.created_at,
      published_at: r.published_at,
      withdrawn_at: r.withdrawn_at,
      withdrawal_reason: r.withdrawal_reason,
      recipient_count: recipients.length,
      read_count: recipients.filter((rr) => rr.read_at !== null).length,
      acknowledged_count: recipients.filter((rr) => rr.acknowledged_at !== null).length,
    };
  });

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Announcements" }]}
      userName={schoolUser.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Announcements</h1>
          <p className="text-sm text-muted-foreground">
            Broadcast notices to guardians — whole school, a grade, a class, or a single student. Publishing is
            restricted by role; every notice is attributed and timestamped.
          </p>
        </div>
        <AnnouncementsSection
          items={items}
          grades={grades}
          streams={streams}
          students={students}
          canPublishSchoolWide={canPublishAny}
          currentSchoolUserId={schoolUser.id}
        />
      </div>
    </AppShell>
  );
}
