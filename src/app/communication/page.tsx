import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ComposeSection, type TemplateOption, type RosterEntry } from "@/components/communication/compose-section";
import { TemplatesSection, type TemplateRow } from "@/components/communication/templates-section";
import { HistorySection, type LogRow } from "@/components/communication/history-section";

export default async function CommunicationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canWrite }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "communication.write" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name ?? "EduCore";

  if (!canWrite) {
    return (
      <AppShell
        breadcrumbs={[{ label: schoolName, href: "/dashboard" }, { label: "Communication" }]}
        userName={schoolUser?.full_name ?? user.email ?? "Account"}
        userRole={roleName}
        onSignOut={logout}
      >
        <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          You don&apos;t have access to Communication.
        </p>
      </AppShell>
    );
  }

  const [{ data: templates }, { data: logs }, { data: students }, { data: classes }] = await Promise.all([
    supabase.from("communication_templates").select("id, name, category, body").order("created_at", { ascending: false }),
    supabase
      .from("notification_logs")
      .select("id, recipient_phone, body, status, provider_response, created_at, students(first_name, last_name)")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("students")
      .select("id, first_name, last_name, current_class_id, streams(class_id, classes(name)), student_guardians(primary_contact, school_users(phone))")
      .eq("status", "active"),
    supabase.from("classes").select("id, name").order("level_order"),
  ]);

  const roster: RosterEntry[] = (students ?? []).map((s) => {
    const stream = s.streams as unknown as { class_id: string; classes: { name: string } | null } | null;
    const guardians = (s.student_guardians ?? []) as unknown as { primary_contact: boolean; school_users: { phone: string | null } | null }[];
    const primary = guardians.find((g) => g.primary_contact);
    return {
      student_id: s.id,
      student_name: `${s.first_name} ${s.last_name}`,
      class_id: stream?.class_id ?? "",
      class_name: stream?.classes?.name ?? "",
      guardian_phone: primary?.school_users?.phone ?? null,
    };
  });

  const logRows: LogRow[] = (logs ?? []).map((l) => {
    const st = l.students as unknown as { first_name: string; last_name: string } | null;
    return {
      id: l.id,
      recipient_phone: l.recipient_phone,
      student_name: st ? `${st.first_name} ${st.last_name}` : null,
      body: l.body,
      status: l.status as LogRow["status"],
      provider_response: l.provider_response,
      created_at: l.created_at,
    };
  });

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName, href: "/dashboard" }, { label: "Communication" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Communication</h1>
          <p className="text-sm text-muted-foreground">SMS composer, templates, and delivery history</p>
        </div>

        <Tabs defaultValue="compose">
          <TabsList>
            <TabsTrigger value="compose">Compose</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="compose">
            <ComposeSection roster={roster} classes={(classes ?? []) as { id: string; name: string }[]} templates={(templates ?? []) as TemplateOption[]} schoolName={schoolName} />
          </TabsContent>

          <TabsContent value="templates">
            <TemplatesSection templates={(templates ?? []) as TemplateRow[]} />
          </TabsContent>

          <TabsContent value="history">
            <HistorySection logs={logRows} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
