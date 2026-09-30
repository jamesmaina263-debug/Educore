import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminLeadsTable, type LeadRow } from "@/components/admin/admin-leads-table";

// Same auth gate as /admin/demo-requests: session check, then
// auth_is_super_admin() -- redundant with the marketing_leads_select RLS
// policy (also gated on auth_is_super_admin()), but the redirect here
// gives a real UX instead of a silently empty table for anyone who isn't
// a super admin.
export default async function AdminLeadsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const { data: leads } = await supabase
    .from("marketing_leads")
    .select("id, created_at, email, resource, source_page, utm_source, utm_medium, utm_campaign")
    .order("created_at", { ascending: false })
    .limit(500);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Marketing lead-magnet captures</h1>
        <p className="text-sm text-muted-foreground">
          Emails captured by the exit-intent CBC Digital Readiness Checklist prompt on the public
          site — visible to platform staff only. Read-only; no status workflow, unlike Demo
          Requests.
        </p>
      </div>
      <AdminLeadsTable rows={(leads ?? []) as LeadRow[]} />
    </div>
  );
}
