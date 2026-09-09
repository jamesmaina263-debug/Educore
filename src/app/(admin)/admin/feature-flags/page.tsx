import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminFeatureFlagsPanel, type FeatureFlagRow, type FeatureFlagSchoolRow } from "@/components/admin/admin-feature-flags-panel";

export default async function AdminFeatureFlagsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const [{ data: flags }, { data: schools }, { data: overrides }] = await Promise.all([
    supabase.from("platform_feature_flags").select("id, key, label, description").order("created_at"),
    supabase.from("schools").select("id, name").order("name"),
    supabase.from("school_feature_flags").select("school_id, flag_id, enabled"),
  ]);

  const enabledMap: Record<string, boolean> = {};
  for (const row of overrides ?? []) {
    enabledMap[`${row.school_id}:${row.flag_id}`] = row.enabled;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Feature flags</h1>
        <p className="text-sm text-muted-foreground">
          Roll a feature out to one or two schools before flipping it on platform-wide. A flag
          with no code checking it yet does nothing — this is just the registry.
        </p>
      </div>
      <AdminFeatureFlagsPanel
        flags={(flags ?? []) as FeatureFlagRow[]}
        schools={(schools ?? []) as FeatureFlagSchoolRow[]}
        enabledMap={enabledMap}
      />
    </div>
  );
}
