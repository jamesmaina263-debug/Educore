import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminCbaWindowsTable, type CbaWindowRow } from "@/components/admin/admin-cba-windows-table";

export default async function AdminCbaWindowsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const { data: windows } = await supabase
    .from("knec_cba_assessment_windows")
    .select("id, title, grade_labels, opens_at, closes_at, notes, source_url, is_active, created_at")
    .order("closes_at", { ascending: false })
    .limit(200);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">KNEC CBA assessment windows</h1>
        <p className="text-sm text-muted-foreground">
          Platform-maintained calendar of KNEC-published CBA/SBA deadlines (e.g. &quot;Grade 4/5 uploads due Oct
          23&quot;). Every school with reminders enabled sees the ones relevant to their grades in Integrations
          &gt; KNEC CBA. This is EduCore-authored operational data, transcribed from KNEC&apos;s own
          circulars/portal notices — always attach a source link where one exists.
        </p>
      </div>
      <AdminCbaWindowsTable rows={(windows ?? []) as CbaWindowRow[]} />
    </div>
  );
}
