import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminModulesPanel, type ModuleRow, type ModuleSchoolRow, type ModuleOverride } from "@/components/admin/admin-modules-panel";

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
    supabase.from("schools").select("id, name, slug, status").order("name"),
    supabase.from("school_modules").select("school_id, module_id, enabled, updated_at, updated_by"),
  ]);

  // Resolve updated_by -> a display name, best-effort. updated_by is whichever platform admin
  // last flipped the switch (a school_users row themselves, same as every other actor in this
  // app -- see auth_is_super_admin) -- an id with no matching row (deleted account, or written
  // by an older direct-SQL change before this column existed) just shows no name rather than
  // blocking the whole page on it.
  const updaterIds = Array.from(new Set((overrides ?? []).map((o) => o.updated_by).filter((id): id is string => !!id)));
  const { data: updaters } = updaterIds.length
    ? await supabase.from("school_users").select("auth_user_id, full_name").in("auth_user_id", updaterIds)
    : { data: [] as { auth_user_id: string; full_name: string }[] };
  const updaterNames = new Map((updaters ?? []).map((u) => [u.auth_user_id, u.full_name]));

  // Keyed as `${schoolId}:${moduleId}` -- absence means enabled, the opt-out convention the rest
  // of school_modules already uses (see setSchoolModule's own comment on why upsert, not update).
  const overrideMap: Record<string, ModuleOverride> = {};
  for (const row of overrides ?? []) {
    overrideMap[`${row.school_id}:${row.module_id}`] = {
      enabled: row.enabled,
      updatedAt: row.updated_at,
      updatedByName: row.updated_by ? (updaterNames.get(row.updated_by) ?? null) : null,
    };
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Modules</h1>
        <p className="text-sm text-muted-foreground">
          Turn optional modules off for schools that don&apos;t use them. Every school keeps every
          module by default -- nothing changes here unless you explicitly turn something off. Core
          modules can&apos;t be disabled.
        </p>
      </div>
      <AdminModulesPanel
        modules={(modules ?? []) as ModuleRow[]}
        schools={(schools ?? []) as ModuleSchoolRow[]}
        overrideMap={overrideMap}
      />
    </div>
  );
}
