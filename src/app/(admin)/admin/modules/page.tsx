import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminModulesPanel, type ModuleRow, type ModuleSchoolRow } from "@/components/admin/admin-modules-panel";

export default async function AdminModulesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const [{ data: modules }, { data: schools }, { data: overrides }] = await Promise.all([
    supabase.from("platform_modules").select("id, key, label, description, is_core").order("is_core", { ascending: false }).order("label"),
    supabase.from("schools").select("id, name").order("name"),
    supabase.from("school_modules").select("school_id, module_id, enabled"),
  ]);

  const enabledMap: Record<string, boolean> = {};
  for (const row of overrides ?? []) {
    enabledMap[`${row.school_id}:${row.module_id}`] = row.enabled;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Modules</h1>
        <p className="text-sm text-muted-foreground">
          Turn optional modules off for schools that don&apos;t use them. Every school keeps every
          module by default -- nothing changes here unless you explicitly turn something off. Core
          modules can&apos;t be disabled. A module with no code checking it yet does nothing when
          toggled here, even though the switch itself works.
        </p>
      </div>
      <AdminModulesPanel
        modules={(modules ?? []) as ModuleRow[]}
        schools={(schools ?? []) as ModuleSchoolRow[]}
        enabledMap={enabledMap}
      />
    </div>
  );
}
