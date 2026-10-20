import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SalesWhatsAppPanel, type ConsentRow, type MessageRow } from "@/components/admin/sales-whatsapp";

export const dynamic = "force-dynamic";

// Sales WhatsApp (first version): who agreed to WhatsApp contact, and an approval queue for messages a PERSON sends
// from their own WhatsApp. Super admin only. Every rule is enforced in the database
// (20261019160000_sales_whatsapp_consent_queue.sql). If the tables are missing (code live a moment before its
// migration) this page says so instead of failing.
export default async function AdminSalesWhatsAppPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const [settingsRes, consentsRes, messagesRes, runningRes, teamRes] = await Promise.all([
    supabase.rpc("admin_get_sales_whatsapp_settings"),
    supabase
      .from("whatsapp_consents")
      .select("id, created_at, phone, contact_name, school_name, source, scope, consent_text, how, note, withdrawn_at")
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("sales_whatsapp_messages")
      .select("id, created_at, consent_id, phone, recipient_name, kind, body, payload_hash, status, reviewed_at, review_note, sent_at")
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("school_subscriptions").select("school_id").eq("status", "trialing"),
    supabase.from("platform_team_members").select("id, name").eq("active", true).order("name"),
  ]);

  const settingsRow = Array.isArray(settingsRes.data) ? settingsRes.data[0] : null;
  const settings = !settingsRes.error && settingsRow ? { promotional_enabled: settingsRow.promotional_enabled === true } : null;
  const tablesMissing = !!consentsRes.error || !!messagesRes.error;

  const ids = (runningRes.data ?? []).map((r: { school_id: string }) => r.school_id);
  const { data: schoolRows } = ids.length ? await supabase.from("schools").select("id, name").in("id", ids) : { data: [] as { id: string; name: string }[] };
  const schools = ((schoolRows ?? []) as { id: string; name: string }[]).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/admin/sales-pipeline" className="text-xs text-muted-foreground underline">
          Back to the sales pipeline
        </Link>
        <h1 className="text-lg font-semibold">Sales WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          Who agreed to be contacted on WhatsApp, and an approval queue for the messages you send them. Nothing is sent by
          the system. Visible to platform staff only.
        </p>
      </div>
      {tablesMissing && (
        <p className="text-xs text-destructive">
          The WhatsApp records could not be read ({consentsRes.error?.message ?? messagesRes.error?.message}). Nothing is shown rather than guessing.
        </p>
      )}
      <SalesWhatsAppPanel
        settings={tablesMissing ? null : settings}
        consents={(consentsRes.error ? [] : (consentsRes.data ?? [])) as ConsentRow[]}
        messages={(messagesRes.error ? [] : (messagesRes.data ?? [])) as MessageRow[]}
        schools={schools}
        team={(teamRes.data ?? []) as { id: string; name: string }[]}
        nowIso={new Date().toISOString()}
      />
    </div>
  );
}
