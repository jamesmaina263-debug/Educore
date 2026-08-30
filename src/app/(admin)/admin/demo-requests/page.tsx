import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminDemoRequestsTable, type DemoRequestRow } from "@/components/admin/admin-demo-requests-table";

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
      "id, created_at, name, school_name, role, email, phone, student_count, message, status, utm_source, utm_medium, utm_campaign",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Marketing demo requests</h1>
        <p className="text-sm text-muted-foreground">
          Submissions from the public /contact form — visible to platform staff only. Read-only.
        </p>
      </div>
      <AdminDemoRequestsTable rows={(requests ?? []) as DemoRequestRow[]} />
    </div>
  );
}
