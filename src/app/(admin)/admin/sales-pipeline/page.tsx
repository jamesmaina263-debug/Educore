import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminSalesPipeline } from "@/components/admin/admin-sales-pipeline";
import { todayInNairobi, weekStartInstant, type SalesActivityRow, type SalesLeadRow } from "@/lib/sales/pipeline";

// Same auth gate as the other platform-admin pages: the (admin) layout already enforces
// auth_is_super_admin(); this repeats it (defense in depth) and the tables' own RLS select
// policies are gated on it too.
export default async function AdminSalesPipelinePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const [leadsRes, activitiesRes, teamRes] = await Promise.all([
    supabase
      .from("sales_leads")
      .select(
        "id, created_at, updated_at, school_name, town_county, school_type, contact_name, contact_role, phone, email, current_system, pain_points, source, student_count, stage, stage_changed_at, lost_reason, assigned_to, next_follow_up_on, notes",
      )
      .order("updated_at", { ascending: false })
      .limit(1000),
    supabase
      .from("sales_lead_activities")
      .select("id, lead_id, created_at, activity_type, performed_by, summary")
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase.from("platform_team_members").select("id, name").eq("active", true).order("name"),
  ]);

  // If the tables aren't there (code deployed a moment before its migration), show a plain
  // notice instead of crashing the page -- same posture as /admin/demo-requests.
  if (leadsRes.error || activitiesRes.error) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Sales pipeline</h1>
        </div>
        <div className="panel p-4 text-sm">
          <p className="font-medium">The sales pipeline isn&apos;t available yet.</p>
          <p className="mt-1 text-muted-foreground">
            Its database tables haven&apos;t been created on this environment. Nothing else is affected — try again after
            the latest database migration has been applied.
          </p>
        </div>
      </div>
    );
  }

  const today = todayInNairobi();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Sales pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Every school the sales team is pursuing: stage, next follow-up and the full visit history. Visible to platform
          staff only.
        </p>
      </div>
      <AdminSalesPipeline
        leads={(leadsRes.data ?? []) as SalesLeadRow[]}
        activities={(activitiesRes.data ?? []) as SalesActivityRow[]}
        reps={(teamRes.data ?? []) as { id: string; name: string }[]}
        today={today}
        weekStartIso={weekStartInstant(today)}
      />
    </div>
  );
}
