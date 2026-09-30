import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminDemoRequestsTable, type DemoRequestRow } from "@/components/admin/admin-demo-requests-table";
import {
  AdminIncompleteDemoLeads,
  type IncompleteDemoLeadRow,
} from "@/components/admin/admin-incomplete-demo-leads";

export default async function AdminDemoRequestsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const { data: requests } = await supabase
    .from("marketing_demo_requests")
    .select(
      "id, created_at, name, school_name, role, email, phone, student_count, message, status, utm_source, utm_medium, utm_campaign, archived_at, assigned_to, assigned_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const { data: teamMembers } = await supabase
    .from("platform_team_members")
    .select("id, name, email")
    .eq("active", true)
    .order("name");

  // Step-1 leads who never finished the form. If the table isn't there yet (code deployed a
  // moment before the migration), this just comes back empty rather than breaking the page.
  const { data: incompleteLeads } = await supabase
    .from("marketing_demo_partial_leads")
    .select("id, created_at, updated_at, status, name, school_name, email, phone, utm_source, utm_medium")
    .in("status", ["incomplete", "contacted"])
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Marketing demo requests</h1>
        <p className="text-sm text-muted-foreground">
          Submissions from the public /contact form — visible to platform staff only. Update the
          status as you follow up.
        </p>
      </div>
      <AdminDemoRequestsTable
        rows={(requests ?? []) as DemoRequestRow[]}
        teamMembers={teamMembers ?? []}
      />
      <AdminIncompleteDemoLeads rows={(incompleteLeads ?? []) as IncompleteDemoLeadRow[]} />
    </div>
  );
}
