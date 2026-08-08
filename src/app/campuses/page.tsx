import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CampusSummaryTable, type CampusSummaryRow } from "@/components/campuses/campus-summary-table";
import { GroupBrandingForm, type GroupBrandingData } from "@/components/campuses/group-branding-form";
import { ApiKeysPanel, type ApiKeyRow } from "@/components/settings/api-keys-panel";
import { issueGroupApiKey, revokeGroupApiKey } from "@/app/campuses/actions";

export default async function CampusesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: groupId }] = await Promise.all([
    supabase
      .from("school_users")
      .select("id, full_name, roles(display_name)")
      .eq("auth_user_id", user.id)
      .maybeSingle(),
    supabase.rpc("auth_group_id"),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const isGroupAdmin = Boolean(groupId);

  let summaryRows: CampusSummaryRow[] = [];
  let brandingData: GroupBrandingData | null = null;
  let apiKeyRows: ApiKeyRow[] = [];
  let canManageApiKeys = false;

  if (isGroupAdmin) {
    const [{ data: summary }, { data: group }, { data: canManageKeys }] = await Promise.all([
      supabase.rpc("group_schools_summary"),
      supabase
        .from("school_groups")
        .select("logo_url, primary_color, custom_domain, custom_domain_status, whitelabel_enabled")
        .eq("id", groupId)
        .maybeSingle(),
      supabase.rpc("auth_has_permission", { p_permission_key: "api.manage" }),
    ]);

    summaryRows = (summary ?? []) as CampusSummaryRow[];
    brandingData = group
      ? {
          logo_url: group.logo_url,
          primary_color: group.primary_color,
          custom_domain: group.custom_domain,
          custom_domain_status: group.custom_domain_status,
          whitelabel_enabled: group.whitelabel_enabled,
        }
      : null;
    canManageApiKeys = canManageKeys === true;

    if (canManageApiKeys) {
      const { data: keys } = await supabase
        .from("api_keys")
        .select("id, name, key_prefix, scopes, status, last_used_at, expires_at, created_at")
        .eq("school_group_id", groupId)
        .order("created_at", { ascending: false });
      apiKeyRows = (keys ?? []) as ApiKeyRow[];
    }
  }

  return (
    <AppShell
      breadcrumbs={[{ label: "Campuses" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-lg font-semibold">Campuses</h1>
          <p className="text-sm text-muted-foreground">
            Cross-campus visibility, group branding, and group-level API access
          </p>
        </div>

        {!isGroupAdmin ? (
          <p className="text-sm text-muted-foreground">
            This area is for Group Admin accounts managing multiple campuses. Your account isn&apos;t
            scoped to a school group.
          </p>
        ) : (
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="branding">Branding</TabsTrigger>
              {canManageApiKeys && <TabsTrigger value="api-keys">API Keys</TabsTrigger>}
            </TabsList>

            <TabsContent value="overview">
              <CampusSummaryTable rows={summaryRows} />
            </TabsContent>

            <TabsContent value="branding">
              {brandingData && <GroupBrandingForm initial={brandingData} />}
            </TabsContent>

            {canManageApiKeys && (
              <TabsContent value="api-keys">
                <ApiKeysPanel
                  rows={apiKeyRows}
                  canManage
                  issueAction={issueGroupApiKey}
                  revokeAction={revokeGroupApiKey}
                />
              </TabsContent>
            )}
          </Tabs>
        )}
      </div>
    </AppShell>
  );
}
