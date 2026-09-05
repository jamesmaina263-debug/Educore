import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ComposeSection, type TemplateOption, type RosterEntry } from "@/components/communication/compose-section";
import { TemplatesSection, type TemplateRow } from "@/components/communication/templates-section";
import { HistorySection, type LogRow } from "@/components/communication/history-section";
import { SupplierComposeSection, type SupplierOption, type SupplierPoOption } from "@/components/communication/supplier-compose-section";
import { WhatsAppInboxSection, type ConversationRow } from "@/components/communication/whatsapp-inbox-section";
import { DeliveryHealthSection, type ChannelStat, type QueuedItem, type FailedItem } from "@/components/communication/delivery-health-section";

export default async function CommunicationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canWrite }, { data: canMessageSuppliers }, { data: canDelete }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "communication.write" }),
    supabase.rpc("auth_can_message_suppliers"),
    supabase.rpc("auth_has_permission", { p_permission_key: "communication.delete" }),
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
        .select("id, channel, recipient_phone, recipient_email, subject, body, status, provider_response, read_at, created_at, archived_at, students(first_name, last_name)")
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
      archived_at: l.archived_at,
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
          <HistorySection logs={logRows} canDelete={canDelete ?? false} />
        </div>
      </AppShell>
    );
  }

  const [{ data: templates }, { data: logs }, { data: students }, { data: classes }, { data: suppliers }, { data: purchaseOrders }, { data: conversations }, { data: archivedConversationsData }] =
    await Promise.all([
      supabase.from("communication_templates").select("id, name, category, body, channel").order("created_at", { ascending: false }),
      supabase
        .from("notification_logs")
        .select("id, channel, recipient_phone, recipient_email, subject, body, status, provider_response, read_at, created_at, archived_at, students(first_name, last_name)")
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
      supabase
        .from("whatsapp_conversations")
        // .is("archived_at", null) keeps the working inbox from accumulating threads the daily
        // retention sweep has already archived (7+ days inactive) -- see
        // 20260824153119_communication_retention_archive_purge.sql. Those threads are still fully
        // browsable, just in the separate "Archived" view fetched just below.
        .select(
          "id, phone_number, status, unread_count, last_message_at, last_message_preview, guardian:guardian_user_id(full_name), student:student_id(first_name, last_name), assigned:assigned_to(full_name)",
        )
        .neq("status", "closed")
        .is("archived_at", null)
        .order("last_message_at", { ascending: false })
        .limit(100),
      supabase
        .from("whatsapp_conversations")
        .select(
          "id, phone_number, status, unread_count, last_message_at, last_message_preview, guardian:guardian_user_id(full_name), student:student_id(first_name, last_name), assigned:assigned_to(full_name)",
        )
        .not("archived_at", "is", null)
        .order("last_message_at", { ascending: false })
        .limit(50),
    ]);

  const sevenDaysAgoIso = new Date(new Date().getTime() - 7 * 86_400_000).toISOString();
  const [{ data: queuedRows }, { data: outcomeRows }, { data: failureRows }] = await Promise.all([
    supabase
      .from("notification_logs")
      .select("id, channel, created_at")
      .eq("status", "queued")
      .order("created_at", { ascending: true }),
    supabase
      .from("notification_logs")
      .select("channel, status")
      .in("status", ["sent", "delivered", "failed"])
      .gte("created_at", sevenDaysAgoIso),
    supabase
      .from("notification_logs")
      .select("id, channel, recipient_type, provider_response, updated_at")
      .eq("status", "failed")
      .order("updated_at", { ascending: false })
      .limit(30),
  ]);

  const queuedItems: QueuedItem[] = (queuedRows ?? []).map((r) => ({ id: r.id, channel: r.channel, created_at: r.created_at }));
  const CHANNELS = ["sms", "email", "whatsapp"] as const;
  const channelStats: ChannelStat[] = CHANNELS.map((channel) => {
    const rows = (outcomeRows ?? []).filter((r) => r.channel === channel);
    const sent = rows.filter((r) => r.status === "sent" || r.status === "delivered").length;
    const failed = rows.filter((r) => r.status === "failed").length;
    const total = sent + failed;
    return { channel, sent, failed, successRate: total === 0 ? null : (sent / total) * 100 };
  });
  const failedItems: FailedItem[] = (failureRows ?? []).map((f) => ({
    id: f.id,
    channel: f.channel,
    recipient_type: f.recipient_type,
    reason: f.provider_response,
    updated_at: f.updated_at,
  }));

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
      archived_at: l.archived_at,
    };
  });

  function toConversationRow(c: NonNullable<typeof conversations>[number]): ConversationRow {
    const guardian = c.guardian as unknown as { full_name: string } | null;
    const student = c.student as unknown as { first_name: string; last_name: string } | null;
    const assigned = c.assigned as unknown as { full_name: string } | null;
    return {
      id: c.id,
      phone_number: c.phone_number,
      status: c.status as ConversationRow["status"],
      unread_count: c.unread_count,
      last_message_at: c.last_message_at,
      last_message_preview: c.last_message_preview,
      guardian_name: guardian?.full_name ?? null,
      student_name: student ? `${student.first_name} ${student.last_name}` : null,
      assigned_to_name: assigned?.full_name ?? null,
    };
  }

  const conversationRows: ConversationRow[] = (conversations ?? []).map(toConversationRow);
  const archivedConversationRows: ConversationRow[] = (archivedConversationsData ?? []).map(toConversationRow);
  const escalatedCount = conversationRows.filter((c) => c.status === "escalated").length;

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
            <TabsTrigger value="whatsapp">
              WhatsApp{escalatedCount > 0 ? ` (${escalatedCount})` : ""}
            </TabsTrigger>
            <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="delivery-health">Delivery health</TabsTrigger>
          </TabsList>

          <TabsContent value="compose">
            <ComposeSection roster={roster} classes={(classes ?? []) as { id: string; name: string }[]} templates={(templates ?? []) as TemplateOption[]} schoolName={schoolName} />
          </TabsContent>

          <TabsContent value="whatsapp">
            <WhatsAppInboxSection conversations={conversationRows} archivedConversations={archivedConversationRows} canDelete={canDelete ?? false} />
          </TabsContent>

          <TabsContent value="suppliers">
            <SupplierComposeSection suppliers={(suppliers ?? []) as SupplierOption[]} purchaseOrders={(purchaseOrders ?? []) as SupplierPoOption[]} />
          </TabsContent>

          <TabsContent value="templates">
            <TemplatesSection templates={(templates ?? []) as TemplateRow[]} />
          </TabsContent>

          <TabsContent value="history">
            <HistorySection logs={logRows} canDelete={canDelete ?? false} />
          </TabsContent>

          <TabsContent value="delivery-health">
            <DeliveryHealthSection queued={queuedItems} channelStats={channelStats} failures={failedItems} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
