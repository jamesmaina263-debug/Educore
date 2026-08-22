import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ComposeSection, type TemplateOption, type RosterEntry } from "@/components/communication/compose-section";
import { TemplatesSection, type TemplateRow } from "@/components/communication/templates-section";
import { HistorySection, type LogRow } from "@/components/communication/history-section";
import { SupplierComposeSection, type SupplierOption, type SupplierPoOption } from "@/components/communication/supplier-compose-section";

export default async function CommunicationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canWrite }, { data: canMessageSuppliers }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "communication.write" }),
    supabase.rpc("auth_can_message_suppliers"),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name ?? "EduCore";

  if (!canWrite && !canMessageSuppliers) {
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

  // A procurement officer (communication.supplier, not communication.write) gets a cut-down page:
  // just "message a supplier" + their own history (RLS already scopes notification_logs to
  // supplier-typed rows for them — see notification_logs_select) -- no guardian roster, no
  // templates, no tabs for anything outside Procurement's remit.
  if (!canWrite) {
    const [{ data: suppliers }, { data: logs }, { data: purchaseOrders }] = await Promise.all([
      supabase.from("suppliers").select("id, name, email").eq("active", true).order("name"),
      supabase
        .from("notification_logs")
        .select("id, channel, recipient_phone, recipient_email, subject, body, status, provider_response, read_at, created_at, students(first_name, last_name)")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("purchase_orders")
        .select("id, po_number, status, supplier_id")
        .neq("status", "cancelled")
        .order("order_date", { ascending: false })
        .limit(100),
    ]);

    const logRows: LogRow[] = (logs ?? []).map((l) => ({
      id: l.id,
      channel: l.channel as LogRow["channel"],
      recipient_phone: l.recipient_phone,
      recipient_email: l.recipient_email,
      subject: l.subject,
      student_name: null,
      body: l.body,
      status: l.status as LogRow["status"],
      provider_response: l.provider_response,
      read_at: l.read_at,
      created_at: l.created_at,
    }));

    return (
      <AppShell
        breadcrumbs={[{ label: schoolName, href: "/dashboard" }, { label: "Communication" }]}
        userName={schoolUser?.full_name ?? user.email ?? "Account"}
        userRole={roleName}
        onSignOut={logout}
      >
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-lg font-semibold">Supplier Communication</h1>
            <p className="text-sm text-muted-foreground">Email suppliers about purchase orders and deliveries.</p>
          </div>
          <SupplierComposeSection suppliers={(suppliers ?? []) as SupplierOption[]} purchaseOrders={(purchaseOrders ?? []) as SupplierPoOption[]} />
          <HistorySection logs={logRows} />
        </div>
      </AppShell>
    );
  }

  const [{ data: templates }, { data: logs }, { data: students }, { data: classes }, { data: suppliers }, { data: purchaseOrders }] = await Promise.all([
    supabase.from("communication_templates").select("id, name, category, body, channel").order("created_at", { ascending: false }),
    supabase
      .from("notification_logs")
      .select("id, channel, recipient_phone, recipient_email, subject, body, status, provider_response, read_at, created_at, students(first_name, last_name)")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("students")
      .select("id, first_name, last_name, current_class_id, streams(class_id, classes(name)), student_guardians(primary_contact, school_users(id, phone, email))")
      .eq("status", "active"),
    supabase.from("classes").select("id, name").order("level_order"),
    supabase.from("suppliers").select("id, name, email").eq("active", true).order("name"),
    supabase
      .from("purchase_orders")
      .select("id, po_number, status, supplier_id")
      .neq("status", "cancelled")
      .order("order_date", { ascending: false })
      .limit(100),
  ]);

  const roster: RosterEntry[] = (students ?? []).map((s) => {
    const stream = s.streams as unknown as { class_id: string; classes: { name: string } | null } | null;
    const guardians = (s.student_guardians ?? []) as unknown as { primary_contact: boolean; school_users: { id: string; phone: string | null; email: string | null } | null }[];
    const primary = guardians.find((g) => g.primary_contact);
    return {
      student_id: s.id,
      student_name: `${s.first_name} ${s.last_name}`,
      class_id: stream?.class_id ?? "",
      class_name: stream?.classes?.name ?? "",
      guardian_phone: primary?.school_users?.phone ?? null,
      guardian_email: primary?.school_users?.email ?? null,
      guardian_school_user_id: primary?.school_users?.id ?? null,
    };
  });

  const logRows: LogRow[] = (logs ?? []).map((l) => {
    const st = l.students as unknown as { first_name: string; last_name: string } | null;
    return {
      id: l.id,
      channel: l.channel as LogRow["channel"],
      recipient_phone: l.recipient_phone,
      recipient_email: l.recipient_email,
      subject: l.subject,
      student_name: st ? `${st.first_name} ${st.last_name}` : null,
      body: l.body,
      status: l.status as LogRow["status"],
      provider_response: l.provider_response,
      read_at: l.read_at,
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
          <p className="text-sm text-muted-foreground">SMS, Email &amp; WhatsApp composer, templates, and delivery history</p>
        </div>

        <Tabs defaultValue="compose">
          <TabsList>
            <TabsTrigger value="compose">Compose</TabsTrigger>
            <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="compose">
            <ComposeSection roster={roster} classes={(classes ?? []) as { id: string; name: string }[]} templates={(templates ?? []) as TemplateOption[]} schoolName={schoolName} />
          </TabsContent>

          <TabsContent value="suppliers">
            <SupplierComposeSection suppliers={(suppliers ?? []) as SupplierOption[]} purchaseOrders={(purchaseOrders ?? []) as SupplierPoOption[]} />
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
